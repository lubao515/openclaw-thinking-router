#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const FIXTURE_ROOT = path.join(process.env.THINKING_ROUTER_STATE_DIR || './state', 'thinking-router-regression-fixtures');
fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
const RUN_ROOT = fs.mkdtempSync(path.join(FIXTURE_ROOT, 'run-'));
const STATE_DIR = path.join(RUN_ROOT, 'state');
const SESSIONS_DIR = path.join(RUN_ROOT, 'sessions');
const STATE_PATH = path.join(STATE_DIR, 'thinking-router-state.json');
const SESSION_INDEX_PATH = path.join(SESSIONS_DIR, 'sessions.json');

fs.mkdirSync(STATE_DIR, { recursive: true });
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

process.env.THINKING_ROUTER_STATE_DIR = STATE_DIR;
process.env.THINKING_ROUTER_STATE_PATH = STATE_PATH;
process.env.THINKING_ROUTER_LOG_PATH = path.join(STATE_DIR, 'thinking-router.log');
process.env.THINKING_ROUTER_PATCH_LOCKS_DIR = path.join(STATE_DIR, 'thinking-router-patch-locks');
process.env.THINKING_ROUTER_AGENT_SESSIONS_DIR = SESSIONS_DIR;
process.env.THINKING_ROUTER_SESSION_INDEX_PATH = SESSION_INDEX_PATH;
process.env.ROUTER_CONFIG_PATH = path.join(__dirname, 'router.config.example.json');

const { routeThinking } = require('./thinking-router.js');

const BASE = {
  channel: 'slack',
  senderId: process.env.ROUTER_ALLOWED_SENDERS?.split(',')[0] || 'YOUR_SLACK_USER_ID',
};

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

writeJson(STATE_PATH, { version: 1, sessions: {} });
writeJson(SESSION_INDEX_PATH, {});

function nowMs() {
  return Date.now();
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function makeSessionState({
  level = 'low',
  engineHint = 'a0-main',
  minutesAgo = 1,
  diagnosticMinutes = 0,
  lowAllowedAfterMinutes = 0,
} = {}) {
  const appliedAt = nowMs() - minutesAgo * 60 * 1000;
  return {
    updatedAt: appliedAt,
    lastAppliedLevel: level,
    lastAppliedAt: appliedAt,
    stickyUntil: level === 'high' || level === 'medium' ? appliedAt + 20 * 60 * 1000 : 0,
    lowAllowedAfter: lowAllowedAfterMinutes ? appliedAt + lowAllowedAfterMinutes * 60 * 1000 : 0,
    contextAnchorLevel: level,
    contextAnchorEngineHint: engineHint,
    contextAnchorAt: appliedAt,
    lastEngineHint: engineHint,
    lastModelOverride: null,
    diagnosticUntil: diagnosticMinutes > 0 ? appliedAt + diagnosticMinutes * 60 * 1000 : 0,
    pendingPatchHash: '',
    lastAppliedPatchHash: '',
  };
}

function seedFixture({ sessionKey, sessionState, assistantText, assistantTimestampMs }) {
  const state = readJson(STATE_PATH, { version: 1, sessions: {} });
  state.sessions[sessionKey] = sessionState;
  writeJson(STATE_PATH, state);

  if (!assistantText) return;

  const sessionId = path.basename(sessionKey).replace(/[^a-zA-Z0-9_-]/g, '_');
  const sessionFile = path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
  const ts = assistantTimestampMs || nowMs() - 30 * 1000;
  const line = {
    type: 'message',
    timestamp: iso(ts),
    message: {
      role: 'assistant',
      timestamp: iso(ts),
      content: [
        { type: 'text', text: assistantText },
      ],
    },
  };
  fs.writeFileSync(sessionFile, `${JSON.stringify(line)}\n`);

  const index = readJson(SESSION_INDEX_PATH, {});
  index[sessionKey] = {
    sessionId,
    updatedAt: ts,
    sessionFile,
  };
  writeJson(SESSION_INDEX_PATH, index);
}

const cases = [
  {
    name: 'config mutation should route to C',
    text: '给我把设置里模型fallback的顺序设置成codex 5.1 mini，codex 5.3，codex gpt 5.4。按照这个顺序fallback',
    expect: { level: 'high', engineHint: 'c-main' },
  },
  {
    name: 'config explain should route to B',
    text: '为啥这种需要改配置的也能是A0呢？',
    expect: { level: 'medium', engineHint: 'b-main' },
  },
  {
    name: 'config read question should route to B',
    text: '设置里 fallback 是什么顺序？',
    expect: { level: 'medium', engineHint: 'b-main' },
  },
  {
    name: 'translation should stay A0',
    text: '把这句话翻译成英文：貌似可以了',
    expect: { level: 'low', engineHint: 'a0-main' },
  },
  {
    name: 'standalone recommendation should stay A1',
    text: '给我推荐一下 Seattle 附近中餐',
    expect: { level: 'low', engineHint: 'a1-main' },
  },
  {
    name: 'abstract routing comparison should stay B',
    text: '比较 A0 A1 A B C 的区别',
    expect: { level: 'medium', engineHint: 'b-main' },
  },
  {
    name: 'gateway config change plus restart should route to C',
    text: '请把 gateway 配置改成 production 并重启',
    expect: { level: 'high', engineHint: 'c-main' },
  },
  {
    name: 'decision ack follow-up should inherit A thread context',
    text: '可以',
    setup: {
      sessionState: makeSessionState({ level: 'low', engineHint: 'a-main', minutesAgo: 1 }),
      assistantText: '如果你愿意我可以继续展开刚才那部分。',
    },
    expect: { level: 'low', engineHint: 'a-main' },
  },
  {
    name: 'action confirmation in diagnostic thread should stay B',
    text: '发了',
    setup: {
      sessionState: makeSessionState({ level: 'medium', engineHint: 'b-main', minutesAgo: 1, diagnosticMinutes: 180 }),
      assistantText: '你现在开一个全新 thread 发 ping，发了我来检查首条实际模型。',
    },
    expect: { level: 'medium', engineHint: 'b-main' },
  },
  {
    name: 'status update in diagnostic thread should stay B',
    text: '还有gateway',
    setup: {
      sessionState: makeSessionState({ level: 'medium', engineHint: 'b-main', minutesAgo: 1, diagnosticMinutes: 180 }),
      assistantText: '你发了结果我来继续检查。',
    },
    expect: { level: 'medium', engineHint: 'b-main' },
  },
  {
    name: 'thread meta question in diagnostic thread should stay B',
    text: '这个用的是什么模型？',
    setup: {
      sessionState: makeSessionState({ level: 'medium', engineHint: 'b-main', minutesAgo: 1, diagnosticMinutes: 180 }),
      assistantText: '我先继续排查这个 thread 的 routing。',
    },
    expect: { level: 'medium', engineHint: 'b-main' },
  },
  {
    name: 'high-risk action confirmation should inherit C thread context',
    text: '发了',
    setup: {
      sessionState: makeSessionState({ level: 'high', engineHint: 'c-main', minutesAgo: 1, diagnosticMinutes: 180, lowAllowedAfterMinutes: 60 }),
      assistantText: '你现在发了我就继续检查这次配置改动是否已经生效。',
    },
    expect: { level: 'high', engineHint: 'c-main' },
  },
];

let failed = 0;

for (const [index, testCase] of cases.entries()) {
  const sessionKey = `agent:main:slack:direct:u0ah304q7fw:thread:router-regression-${index}`;
  if (testCase.setup) {
    seedFixture({ sessionKey, ...testCase.setup });
  }

  const result = routeThinking({
    ...BASE,
    sessionKey,
    text: testCase.text,
  }, { dryRun: true });

  const mismatches = [];
  for (const [key, expected] of Object.entries(testCase.expect)) {
    if (result[key] !== expected) {
      mismatches.push(`${key}: expected=${expected} actual=${result[key]}`);
    }
  }

  if (mismatches.length > 0) {
    failed += 1;
    console.error(`FAIL: ${testCase.name}`);
    console.error(`  text: ${testCase.text}`);
    for (const line of mismatches) console.error(`  ${line}`);
    console.error(`  classifyReasons=${JSON.stringify(result.classifyReasons || [])}`);
    console.error(`  engineReasons=${JSON.stringify(result.engineReasons || [])}`);
    console.error(`  contextCarry=${JSON.stringify(result.contextCarry || null)}`);
  } else {
    console.log(`PASS: ${testCase.name} -> level=${result.level} engine=${result.engineHint}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} regression case(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${cases.length} regression cases passed.`);
console.log(`Fixtures: ${RUN_ROOT}`);
