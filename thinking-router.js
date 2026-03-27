// ─── SECTION 1: REQUIRES ─────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const crypto = require('crypto');

// ─── SECTION 2: ENV / PATH CONSTANTS ─────────────────────────────────────────
const HOME = process.env.HOME || '/home/ubuntu';
const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE_DIR || path.join(HOME, '.openclaw/workspace');
const STATE_DIR = process.env.THINKING_ROUTER_STATE_DIR || path.join(WORKSPACE_DIR, 'state');
const STATE_PATH = process.env.THINKING_ROUTER_STATE_PATH || path.join(STATE_DIR, 'thinking-router-state.json');
const LOG_PATH = process.env.THINKING_ROUTER_LOG_PATH || path.join(STATE_DIR, 'thinking-router.log');
const ALERT_LOG_PATH = process.env.THINKING_ROUTER_ALERT_LOG_PATH || path.join(STATE_DIR, 'thinking-router-alerts.log');
const PATCH_LOCKS_DIR = process.env.THINKING_ROUTER_PATCH_LOCKS_DIR || path.join(STATE_DIR, 'thinking-router-patch-locks');
const AGENT_SESSIONS_DIR = process.env.THINKING_ROUTER_AGENT_SESSIONS_DIR || path.join(HOME, '.openclaw/agents/main/sessions');
const SESSION_INDEX_PATH = process.env.THINKING_ROUTER_SESSION_INDEX_PATH || path.join(AGENT_SESSIONS_DIR, 'sessions.json');
const CONFIG_PATH = process.env.ROUTER_CONFIG_PATH || path.join(__dirname, '..', 'router.config.json');

// ─── SECTION 3: DEFAULTS ─────────────────────────────────────────────────────
const REQUIRED_TIERS = ['a0-main','a1-main','a-main','b-main','c-main','main'];
const DEFAULT_TIER_MODELS = {
  'a0-main': 'google/gemini-3.1-flash-lite-preview',
  'a1-main': 'openai-codex/gpt-5.1-codex-mini',
  'a-main': 'anthropic/claude-sonnet-4-6',
  'b-main': 'anthropic/claude-sonnet-4-6',
  'c-main': 'anthropic/claude-sonnet-4-6',
  main: null,
};

// Default model pools (used when router.config.json is absent or has no pools)
const DEFAULT_MODEL_POOLS = [
  {
    id: 'pool-1',
    weight: 5,
    tiers: {
      'a0-main': 'google/gemini-3.1-flash-lite-preview',
      'a1-main': 'openai-codex/gpt-5.1-codex-mini',
      'a-main': 'anthropic/claude-sonnet-4-6',
      'b-main': 'anthropic/claude-sonnet-4-6',
      'c-main': 'anthropic/claude-sonnet-4-6',
      main: null,
    },
  },
  {
    id: 'pool-2',
    weight: 1,
    tiers: {
      'a0-main': 'google/gemini-3.1-flash-lite-preview',
      'a1-main': 'openai-codex/gpt-5.1-codex-mini',
      'a-main': 'openai-codex/gpt-5.4-mini',
      'b-main': 'openai-codex/gpt-5.4-mini',
      'c-main': 'openai-codex/gpt-5.4',
      main: null,
    },
  },
];

function buildDefaultHeuristics() {
  return {
    configMutation: {
      configSurface: "(?:设置里|配置里|设置|配置|fallback|默认模型|model fallback|default model|provider|auth profile|模型顺序|模型 fallback|模型fallback|模型优先级|fallback 顺序|fallback顺序|model order|模型列表)",
      mutationVerb: "(?:改成|设成|设置成|设为|设置为|调成|调到|换成|切到|调整为|改一下|调一下|换一下|更新为|改成这个顺序|按这个顺序|按照这个顺序|按这个顺序排|按照这个顺序排|顺序.*(?:改|调|设|排|换)|排成这个顺序|排一下顺序|重新排序|重排|放到前面|放到后面|提到第一|放第一|放第二|放第三)",
      imperative: "^(?:给我把|帮我把|请把|把|直接把|现在把|马上把|替我把|给我改|帮我改|请改|直接改|现在改|马上改)"
    },
    assistantRequest: {
      actionRequest: "(?:你(?:现在|再|先)?(?:发|试|测|跑|贴|开|重启|检查|确认|看|告诉)|再发一次|发了我|我来检查|我来看看|复测|告诉我结果|贴一下结果|开一个(?:全新)?\\s*thread)",
      decisionRequest: "(?:选哪个|方案[一二三AB]吧|你选|二选一|1 还是 2|A 还是 B|下一步选|先做第[一二三]|要不要我|如果你愿意|如果你要|要我继续|要不要继续|如果需要我可以继续|如果你点头我就继续|你决定我就往下做)",
      statusRequest: "(?:怎么样了|有结果吗|有进展吗|然后呢|结果发我|回我一下|告诉我有没有|确认一下结果)"
    },
    followup: {
      actionConfirmation: "^(?:发了|试了|测了|改了|加了|删了|重启了|设置在环境变量中了|已经好了|弄好了|可以了|貌似可以了|搞定了|完成了)$",
      statusUpdate: "^(?:貌似可以了|感觉还是没生效|还是没生效|还是不行|不行|报错了|挂了|好了但|可以了么[?？]?|好了么[?？]?|怎么样了[?？]?|咋样了[?？]?|还有gateway)$",
      threadMetaQuestion: "^(?:(?:这个|这条|刚才那个|这次|现在)(?:用的|是用|走的)?(?:是)?|)(?:什么模型|哪个模型|什么回答的|什么模型回答的|用的是什么模型|是用什么模型回答的|这个用的是什么模型|这条用的是什么模型|现在是什么模型|什么思考强度|思考强度是多少|为什么是主模型|为什么还是主模型|为啥还是主模型|为啥不是Gemini|为什么不是Gemini)[?？]?$",
      decisionAck: "^(?:可以|可以的|好的|行|要|是的|1|2|3|A|B|方案[一二三AB]吧|用方案A吧|用方案B吧|先做第一件|可以先走第二步)$",
      referentialFollowup: "^(?:这两个|这俩|这个|这些|刚才那个|刚才那两个|上面那个|上面那两个|前面那个|前面那两个|那两个)(?:是不是|要不要|应不应该|该不该|能不能|可不可以|是否|该如何|怎么|怎么处理|放在|记到|放到|归档到|记忆里|记忆中|保留|检索)[^\\n]*$",
      contextFollowup: "^(?:[?？]+|在么[?？]?|在吗[?？]?|在[?？]?|ping[?？]?|好了么[?？]?|好了吗[?？]?|好了没[?？]?|怎么样了[?？]?|咋样了[?？]?|有进展吗[?？]?|进展呢[?？]?|有结果吗[?？]?|结果呢[?？]?|完成了吗[?？]?|完成了没[?？]?|然后呢[?？]?|接下来呢[?？]?|继续|继续吧|继续看|再看下|再看一下|再确认下|再确认一下|确认一下|确认下|ok[?？]?|okay[?？]?|收到|明白|行|好的|装好了吗[?？]?|搞好了吗[?？]?|弄好了吗[?？]?|完了吗[?？]?)$"
    },
    diagnosticSticky: "(?:排查|调试|debug|诊断|router|routing|session|thread|hook|patch|state|gateway|auth|credential|api key|模型|思考强度|dry run|复测|heuristic|启发式|配置|环境变量)",
    tiers: {
      a0: {
        wordingTask: "(?:翻译|改写|润色|措辞|一句话|精简|简化表达|translate|rewrite|rephrase|wording|wordsmith)",
        hardTranslation: "^(?:把(?:这句话|这段话|这段文字|下面这句话|下面这段话)?翻译成(?:英文|英语|中文|日文|韩文|法文|德文)|翻译成(?:英文|英语|中文|日文|韩文|法文|德文)[:：]|translate(?: this| the following)?[:：])",
        oneLinerExplain: "^(?:一句话解释|一行解释|用一句话解释|one[- ]liner(?: explain)?|briefly explain)"
      },
      a1: {
        exclude: "(?:\\bA0\\b|\\bA1\\b|\\bA\\b|\\bB\\b|\\bC\\b|thinking|router|route|routing|hook|session|thread|heuristic|规则|模型|思考强度)",
        excludeLeads: "^(?:分析|解释|说明|debug|排查|检查)",
        include: "(?:总结|概述|推荐|建议|shortlist|选哪个|对比|比较|草稿|draft|shopping|restaurant|怎么选|方案比较|summary|recommend|comparison|优缺点|pros.{0,5}cons|优点和缺点|利弊|好处和坏处|有哪些优势|有哪些劣势|哪些好处|哪些坏处|好在哪|差在哪)"
      },
      a: {
        lightweightEdit: "(?:改成项目符号|改成\\s*bullet|改成列表|改得更|压缩成|保留核心|不要展开|控制在三点内|删掉最后一段|语气自然一点|语气更温和|更口语一点|更直接一点|更简短一点|更精炼一点|项目符号)"
      },
      b: {
        normalExecution: "(?:action items|行动项|RCA 提纲|RCA大纲|提炼成 action items|提炼成行动项|下一步检查顺序|检查顺序|排查顺序|实施步骤|实施提纲|实施计划|变更说明|会议纪要提炼|整理这段错误日志|复盘提纲|验证清单|checklist|阶段计划|分成阶段|API 变更写一版说明|写一版说明|实施步骤)"
      },
      c: {
        criticalStateChange: "(?:(?:生产|线上|prod|production).*(?:重置|回滚|迁移|切到|切流|替换|关闭|绕过|改掉|修改|更新|删除|清掉|放行|启用|生效|reload|schema|数据库|告警|门限|证书|secret|secrets)|(?:ssh|2fa|secrets?|secret|证书|私钥|签名校验|安全校验|auth|权限表|bucket|public bucket|防火墙).*(?:关闭|绕过|重置|开放|放行|写进仓库|推上去|改成\\s*public|开放给所有人)|(?:市价单|限价单|开仓|平仓|自动平仓|仓位|风控阈值).*(?:自动|直接|立即|立刻|调到\\s*0|关闭|启用|生效)|(?:删表|drop table|purge|truncate)|(?:告警规则).*(?:清掉|删除|关闭))"
      }
    },
    routeOverride: {
      systemDomainExplain: "(?:配置|fallback|设置|模型|思考强度|router|routing|session|thread|hook|gateway|auth|credential|Gemini|model|A0|A1|A|B|C)",
      debugAuditTask: "(?:检查|排查|解决|修复|debug|看看|审查|验证|核对|看一下|看下|调试|修改|分析)"
    },
    intent: {
      explainLead: "^(?:解释一下|解释|说明一下|说明|说说|为什么|为啥|比较一下|比较|分析一下|分析|总结一下|总结|概述一下|概述|梳理一下|梳理|给个草案|给我个草案|帮我理解|展示一下|show me|summari[sz]e|explain|compare|why\\b|meaning\\b|difference\\b)",
      draftLead: "^(?:写个|写一版|起草|草拟|draft|帮我写个|帮我写一版).*(?:草稿|draft|说明|公告|更新|总结|brief|提纲)",
      inspectLead: "^(?:帮我\\s*(?:debug|排查|检查|看下|看一下|分析|比较|总结|解释|说明|梳理)|debug\\b|排查(?:一下)?|检查(?:一下)?)",
      imperativeLead: "^(?:帮我把|请把|直接|立刻|现在就|马上|替我把)",
      explain: "(?:看一下|看下|看看|解释|说明|说说|总结|比较|区别|是什么|什么是|为什么|为啥|含义|帮我理解|展示|梳理|给个草案|草案|思路|review|summari[sz]e|explain|show|compare|draft|meaning|why|debug|排查|检查|提纲|action items|行动项)",
      storeRecord: "(?:记一下|记录一下|存一下|存下来|把.{0,30}记录|帮我记|记下来)",
      execute: "(?:改|修改|应用|启用|禁用|删除|删掉|覆盖|清空|清掉|重启|部署|替换|发送|下单|买入|卖出|开仓|平仓|执行|运行|修复|处理掉|做掉|提交|发布|安装|重装|更新|迁移|回滚|切流|切到|重置|放行|开放给所有人|绕过|关闭校验|跳过检查|上线|生效|reload|开放|接到自动化流程|写进仓库|推上去|apply|enable|disable|delete|remove|overwrite|purge|restart|deploy|replace|send|order|buy|sell|execute|run|fix|install|reinstall|update|patch|rollback|migrate|reset|bypass|reload)"
    },
    risk: {
      patterns: [
        { pattern: "(?:交易|下单|买入|卖出|开仓|平仓|仓位|止损|止盈|盈亏|风控|风控阈值|市价单|限价单|pdt|broker|trading|order|position|portfolio|risk|信号刷新|刷新信号|交易信号|做多信号|做空信号|买入信号|卖出信号|候选|策略|持仓|多空|做空|做多|买卖|减仓|加仓|regime)", domain: "trading-risk" },
        { pattern: "(?:密码|口令|密钥|token(?!\\s*(?:optimizer|count|budget|limit|window|usage|compression|truncat))|api key|auth|oauth|登录|认证|ssh|权限|安全|security|credential|secret|secrets|2fa|证书|私钥|签名|校验|bucket|public bucket|private bucket|acl)", domain: "security-risk" },
        { pattern: "(?=.*(?:config|配置|设置|cron|webhook|hook|plugin|automatic|自动化|deploy|部署|patch|apply|上线|生产|prod|production|回滚|迁移|schema|数据库|db|告警|告警规则|reload|切流|网关|环境变量|session\\.patch|fallback|默认模型|model fallback|default model|auth profile))(?=.*(?:restart|重启|run|执行|apply|enable|disable|deploy|start|启动|运行|修改|更改|切换|reload|update|install|安装|配置|创建))", domain: "ops-risk" },
        { pattern: "(?:删除|删掉|覆盖|清空|清掉|重置|删表|drop(?:\\s+table)?|purge|truncate|改成\\s*public|开放给所有人|remove|delete|overwrite)", domain: "destructive-risk" },
        { pattern: "(?:账单|扣费|付款|支付失败|支付回调|billing|payment|\\bcharge\\b|bank|brokerage|margin|autopay)", domain: "billing-risk" }
      ],
      tradingStatusOnly: "^(?:交易(?:日志|报告|状态|记录|结果|摘要)|(?:今日|本次)?(?:运行结果|执行结果|cron结果|定时任务结果)|no candidates?|no signals?|no orders?|未下单|无候选|无信号|无交易|任务完成|执行完成|检查完成|状态正常|运行正常)"
    },
    complexity: [
      { pattern: "(?:为什么|原因|排查|调试|debug|诊断|分析|比较|权衡|方案|设计|架构|实现|机制|原理|逻辑|优化|草案|review|draft)", reason: "analysis", weight: 2 },
      { pattern: "(?:\\b(?:thread|session|model|thinking|route|routing|hook|plugin|ws|rpc|worker|state)\\b|session\\.patch)", reason: "system-mechanics", weight: 1 },
      { pattern: "(?:并且|而且|然后|同时|另外|再|先.*再|first.*then|and then|meanwhile)", reason: "multi-step", weight: 1 },
      { pattern: "(?:分别(?:是|代表|对应|说明|指的)|各自(?:是|代表)|依次(?:是|代表)|列举|依次介绍)", reason: "enumeration-analysis", weight: 2 }
    ],
    question: {
      shortQuestion: "(?:[?？]$|是什么时候|是什么|是谁|在哪|哪天|几号|几月几日|多大|多久|何时|when|what|who|where|which|how old)$",
      disqualifyContext: "(?:为什么|为啥|咋|怎么|怎麽|原因|分析|比较|区别|方案|设计|调试|排查|架构|实现|路由|模型|thinking|router|session|thread|Gemini|gemini|抽风|切换|意思是|(?:(?:根据|了解|基于|我们)|fallback|(?:分别(?:是|代表|对应|说明|指的)|各自(?:是|代表)|依次(?:是|代表)|列举|依次介绍)))"
    },
    contextHeavyFollowup: "(?:根据你对|根据你|根据我|根据我们|为啥|为什么|怎么|如何|基于上面|基于之前|结合上文|沿用刚才|按刚才|延续这个|这个线程|同一线程|接着上个|上个问题|刚才说的|前面提到|based on (?:above|earlier)|from earlier|in this thread|continue from|一样么|一样吗|相同吗|相同么|那这个呢|^这个呢$|^那个呢$|结论是啥|结论呢|结论是什么|怎么看|怎么理解|有啥区别|有什么区别|(?:对吧(?:[?？])?|是吗(?:[?？])?|是吧(?:[?？])?)$)",
    explicitLevel: {
      high: "(?:高强度思考|高强度|深度思考|深入思考|认真想|仔细想|好好想|严谨分析|全面分析|认真推演|请认真分析|请深入分析|严谨检查|仔细检查|认真检查|全面检查|严格检查|ultrathink|deep think|deep analysis|think hard|think harder|high effort|high intensity)",
      medium: "(?:中等强度|中等思考|普通分析|适中一点|中等分析|medium)",
      low: "(?:简单点|简单说|简短点|快速一点|快点|别想太多|不用深想|一句话|只要结论|不用展开|给我命令就行|快速确认|brief|quick|quickly|simple|short|one-liner)"
    },
    explicitPrefixToEngineHint: {
      main: "main",
      m: "main",
      gemini: "a0-main",
      g: "a0-main",
      review: "a0-main",
      r: "a0-main",
      a0: "a0-main",
      a1: "a1-main",
      a: "a-main",
      b: "b-main",
      c: "c-main"
    }
  };
}

const DEFAULT_HEURISTICS_SPEC = buildDefaultHeuristics();

// ─── SECTION 4: CONFIG LOADING ───────────────────────────────────────────────
function loadExternalConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('[thinking-router] Failed to load router.config.json, using defaults:', err.message);
  }
  return {};
}

const _extCfg = loadExternalConfig();

// ─── SECTION 5: CONFIG RESOLUTION ────────────────────────────────────────────
function mergeObjects(defaultObj, overrideObj) {
  if (!overrideObj) return defaultObj;
  const result = { ...defaultObj };
  for (const [key, value] of Object.entries(overrideObj)) {
    if (Array.isArray(value)) {
      result[key] = value;
    } else if (value && typeof value === 'object') {
      result[key] = mergeObjects(defaultObj?.[key] ?? {}, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function compilePattern(spec, fallback) {
  const input = spec ?? fallback;
  if (!input) return null;
  if (input instanceof RegExp) return input;
  if (typeof input === 'string') {
    return new RegExp(input, 'i');
  }
  if (typeof input === 'object' && typeof input.pattern === 'string') {
    return new RegExp(input.pattern, input.flags || 'i');
  }
  return null;
}

function compileHeuristicsSpec(spec) {
  const explicitPrefixSpec = spec.explicitPrefixToEngineHint || {};
  const explicitPrefixToEngineHint = {};
  for (const [alias, hint] of Object.entries(explicitPrefixSpec)) {
    if (!alias || !hint) continue;
    explicitPrefixToEngineHint[String(alias).toLowerCase()] = hint;
  }

  return {
    configMutation: {
      configSurface: compilePattern(spec.configMutation.configSurface),
      mutationVerb: compilePattern(spec.configMutation.mutationVerb),
      imperative: compilePattern(spec.configMutation.imperative),
    },
    assistantRequest: {
      actionRequest: compilePattern(spec.assistantRequest?.actionRequest),
      decisionRequest: compilePattern(spec.assistantRequest?.decisionRequest),
      statusRequest: compilePattern(spec.assistantRequest?.statusRequest),
    },
    followup: {
      actionConfirmation: compilePattern(spec.followup?.actionConfirmation),
      statusUpdate: compilePattern(spec.followup?.statusUpdate),
      threadMetaQuestion: compilePattern(spec.followup?.threadMetaQuestion),
      decisionAck: compilePattern(spec.followup?.decisionAck),
      referentialFollowup: compilePattern(spec.followup?.referentialFollowup),
      contextFollowup: compilePattern(spec.followup?.contextFollowup),
    },
    diagnosticSticky: compilePattern(spec.diagnosticSticky),
    tiers: {
      a0: {
        wordingTask: compilePattern(spec.tiers?.a0?.wordingTask),
        hardTranslation: compilePattern(spec.tiers?.a0?.hardTranslation),
        oneLinerExplain: compilePattern(spec.tiers?.a0?.oneLinerExplain),
      },
      a1: {
        exclude: compilePattern(spec.tiers?.a1?.exclude),
        excludeLeads: compilePattern(spec.tiers?.a1?.excludeLeads),
        include: compilePattern(spec.tiers?.a1?.include),
      },
      a: {
        lightweightEdit: compilePattern(spec.tiers?.a?.lightweightEdit),
      },
      b: {
        normalExecution: compilePattern(spec.tiers?.b?.normalExecution),
      },
      c: {
        criticalStateChange: compilePattern(spec.tiers?.c?.criticalStateChange),
      },
    },
    routeOverride: {
      systemDomainExplain: compilePattern(spec.routeOverride?.systemDomainExplain),
      debugAuditTask: compilePattern(spec.routeOverride?.debugAuditTask),
    },
    intent: {
      explainLead: compilePattern(spec.intent.explainLead),
      draftLead: compilePattern(spec.intent.draftLead),
      inspectLead: compilePattern(spec.intent.inspectLead),
      imperativeLead: compilePattern(spec.intent.imperativeLead),
      explain: compilePattern(spec.intent.explain),
      storeRecord: compilePattern(spec.intent.storeRecord),
      execute: compilePattern(spec.intent.execute),
    },
    risk: {
      patterns: (spec.risk.patterns || []).map((entry) => ({
        pattern: compilePattern(entry.pattern),
        domain: entry.domain,
      })),
      tradingStatusOnly: compilePattern(spec.risk.tradingStatusOnly),
    },
    complexity: (spec.complexity || []).map((entry) => ({
      pattern: compilePattern(entry.pattern),
      reason: entry.reason,
      weight: entry.weight,
    })),
    question: {
      shortQuestion: compilePattern(spec.question.shortQuestion),
      disqualifyContext: compilePattern(spec.question.disqualifyContext),
    },
    contextHeavyFollowup: compilePattern(spec.contextHeavyFollowup),
    explicitLevel: {
      high: compilePattern(spec.explicitLevel?.high),
      medium: compilePattern(spec.explicitLevel?.medium),
      low: compilePattern(spec.explicitLevel?.low),
    },
    explicitPrefixToEngineHint,
  };
}

const heuristicsSpec = mergeObjects(DEFAULT_HEURISTICS_SPEC, _extCfg.heuristics || {});
const compiledHeuristics = compileHeuristicsSpec(heuristicsSpec);

function fillModelPoolTiers(pool, defaults, index) {
  const raw = pool?.tiers || {};
  const normalized = {};
  const missing = [];
  for (const tier of REQUIRED_TIERS) {
    if (Object.prototype.hasOwnProperty.call(raw, tier)) {
      normalized[tier] = raw[tier];
    } else {
      normalized[tier] = defaults[tier] ?? null;
      missing.push(tier);
    }
  }
  if (missing.length) {
    console.warn(`[thinking-router] model pool ${pool?.id || `pool-${index + 1}`} missing tiers ${missing.join(', ')}, falling back to defaults for those tiers.`);
  }
  return normalized;
}

function resolveAllowedSenders(extCfg) {
  const normalizeList = (list = []) => {
    const values = new Set();
    for (const raw of list) {
      const normalized = normalizeSender(String(raw || ''));
      if (normalized) values.add(normalized);
    }
    return values;
  };

  const envEntries = (process.env.ROUTER_ALLOWED_SENDERS || '').split(',').filter(Boolean);
  const normalizedEnv = normalizeList(envEntries);
  if (normalizedEnv.size > 0) {
    return normalizedEnv;
  }

  if (Array.isArray(extCfg.allowedSenders) && extCfg.allowedSenders.length > 0) {
    const normalized = normalizeList(extCfg.allowedSenders);
    if (normalized.size > 0) return normalized;
  }

  console.warn('[thinking-router] allowedSenders not configured; allowing all senders. Fill router.config.json or set ROUTER_ALLOWED_SENDERS to restrict it.');
  return null;
}

function resolveEnabledChannels(extCfg) {
  if (Array.isArray(extCfg.enabledChannels) && extCfg.enabledChannels.length > 0) {
    return new Set(extCfg.enabledChannels);
  }
  return new Set(['slack']);
}

function resolveModelPools(extCfg) {
  const pools = Array.isArray(extCfg.modelPools) ? extCfg.modelPools : [];
  if (pools.length > 0) {
    return pools.map((pool, index) => ({
      ...pool,
      label: pool.label || pool.id || `pool-${index + 1}`,
      tiers: fillModelPoolTiers(pool, DEFAULT_TIER_MODELS, index),
    }));
  }
  return DEFAULT_MODEL_POOLS.map((pool, index) => ({
    ...pool,
    label: pool.label || pool.id || `pool-${index + 1}`,
    tiers: fillModelPoolTiers(pool, DEFAULT_TIER_MODELS, index),
  }));
}

const _timing = _extCfg.timing || {};
const _patchRetry = _extCfg.patchRetry || {};

const CONFIG = {
  enabledChannels: resolveEnabledChannels(_extCfg),
  allowedSenders: resolveAllowedSenders(_extCfg),
  heuristics: compiledHeuristics,
  manualHoldMinutes: _timing.manualHoldMinutes ?? 4 * 60,
  dedupeMinutes: _timing.dedupeMinutes ?? 5,
  tiers: {
    passthrough: 'main',
    a0: 'a0-main',
    a1: 'a1-main',
    a: 'a-main',
    b: 'b-main',
    c: 'c-main',
  },
  engineModelByHint: {
    'a0-main': 'google/gemini-3.1-flash-lite-preview',
    'a1-main': 'openai-codex/gpt-5.1-codex-mini',
    'a-main': 'anthropic/claude-sonnet-4-6',
    'b-main': 'anthropic/claude-sonnet-4-6',
    'c-main': 'anthropic/claude-sonnet-4-6',
    main: null,
  },
  tierRank: {},
  tierByLevel: {},
  modelFloor: {
    stickyHighMinTier: null,
    explicitHighHoldTier: null,
  },
  patchRetry: {
    attempts: _patchRetry.attempts ?? 8,
    initialDelayMs: _patchRetry.initialDelayMs ?? 400,
    baseDelayMs: _patchRetry.baseDelayMs ?? 1500,
    maxDelayMs: _patchRetry.maxDelayMs ?? 20000,
    jitterMs: _patchRetry.jitterMs ?? 700,
  },
  stickyMinutes: {
    medium: _timing.stickyMinutes?.medium ?? 60,
    high: _timing.stickyMinutes?.high ?? 90,
  },
  lowAllowedAfterMinutes: {
    high: _timing.lowAllowedAfterMinutes?.high ?? 60,
  },
  contextCarryMinutes: _timing.contextCarryMinutes ?? 120,
  diagnosticStickyMinutes: _timing.diagnosticStickyMinutes ?? 90,
  modelHoldMinutes: _timing.modelHoldMinutes ?? 120,
  assistantContextScanMessages: _extCfg.assistantContextScanMessages ?? 8,
  keepStateDays: _extCfg.keepStateDays ?? 30,
  keepMaxSessions: _extCfg.keepMaxSessions ?? 500,
};

CONFIG.modelPools = resolveModelPools(_extCfg);

CONFIG.explicitPrefixToEngineHint = compiledHeuristics.explicitPrefixToEngineHint || {};

(function syncEngineModelByHintFromPrimaryPool() {
  const primary = CONFIG.modelPools.find(p => p.id === 'pool-1') || CONFIG.modelPools[0];
  if (!primary) return;
  Object.assign(CONFIG.engineModelByHint, primary.tiers);
})();

function getStickyModelPoolId(sessionState = {}) {
  const directPoolId = typeof sessionState?.modelPoolId === 'string' ? sessionState.modelPoolId : '';
  if (directPoolId) return directPoolId;
  const legacyMap = sessionState?.modelPoolByTier;
  if (legacyMap && typeof legacyMap === 'object') {
    const first = Object.values(legacyMap).find((value) => typeof value === 'string' && value);
    if (first) return first;
  }
  return null;
}

function buildModelPoolIndexes() {
  CONFIG._modelPoolsById = {};
  CONFIG._modelPoolsForTier = {};
  const pools = Array.isArray(CONFIG.modelPools) ? CONFIG.modelPools : [];
  const normalizedPools = [];
  for (const pool of pools) {
    if (!pool || typeof pool !== 'object' || !pool.id) continue;
    const normalized = {
      ...pool,
      weight: Number(pool.weight) > 0 ? Number(pool.weight) : 1,
      tiers: { ...(pool.tiers || {}) },
    };
    normalizedPools.push(normalized);
    CONFIG._modelPoolsById[normalized.id] = normalized;
    for (const tier of Object.keys(normalized.tiers)) {
      if (!CONFIG._modelPoolsForTier[tier]) CONFIG._modelPoolsForTier[tier] = [];
      CONFIG._modelPoolsForTier[tier].push(normalized);
    }
  }
  CONFIG.modelPools = normalizedPools;
}

function selectModelPoolForEngineHint(engineHint, sessionState = {}) {
  if (!engineHint) return { poolId: null, model: null, reused: false };
  const tierPools = CONFIG._modelPoolsForTier?.[engineHint] || [];
  if (!tierPools.length) {
    return { poolId: null, model: null, reused: false };
  }
  const existingPoolId = getStickyModelPoolId(sessionState);
  if (existingPoolId) {
    const existingPool = CONFIG._modelPoolsById?.[existingPoolId];
    if (existingPool && Object.prototype.hasOwnProperty.call(existingPool.tiers || {}, engineHint)) {
      return { poolId: existingPool.id, model: existingPool.tiers[engineHint], reused: true };
    }
  }
  const totalWeight = tierPools.reduce((sum, pool) => sum + (Number(pool.weight) || 0), 0);
  const normalizedTotal = totalWeight > 0 ? totalWeight : tierPools.length;
  let threshold = Math.random() * normalizedTotal;
  for (const pool of tierPools) {
    const weight = Number(pool.weight) > 0 ? Number(pool.weight) : 1;
    threshold -= weight;
    if (threshold <= 0) {
      return { poolId: pool.id, model: pool.tiers[engineHint], reused: false };
    }
  }
  const fallback = tierPools[tierPools.length - 1];
  return { poolId: fallback.id, model: fallback.tiers[engineHint], reused: false };
}

buildModelPoolIndexes();

CONFIG.tierRank = {
  [CONFIG.tiers.passthrough]: 0,
  [CONFIG.tiers.a0]: 1,
  [CONFIG.tiers.a1]: 2,
  [CONFIG.tiers.a]: 3,
  [CONFIG.tiers.b]: 4,
  [CONFIG.tiers.c]: 5,
};

CONFIG.tierByLevel = {
  low: CONFIG.tiers.a,
  medium: CONFIG.tiers.b,
  high: CONFIG.tiers.c,
};

CONFIG.modelFloor = {
  stickyHighMinTier: CONFIG.tiers.c,
  explicitHighHoldTier: CONFIG.tiers.c,
};

const LEVEL_RANK = { low: 1, medium: 2, high: 3 };

// ─── SECTION 6: RUNTIME FUNCTIONS ────────────────────────────────────────────
function resolveConfiguredModel(engineHint) {
  if (!Object.prototype.hasOwnProperty.call(CONFIG.engineModelByHint, engineHint)) return undefined;
  return CONFIG.engineModelByHint[engineHint];
}

function resolveConfiguredModelSelection(engineHint, sessionState = {}) {
  const poolSelection = selectModelPoolForEngineHint(engineHint, sessionState);
  if (poolSelection.model !== null && poolSelection.model !== undefined) {
    return poolSelection;
  }
  return {
    poolId: null,
    model: resolveConfiguredModel(engineHint),
    reused: false,
  };
}

function getEngineTierRank(engineHint) {
  if (!Object.prototype.hasOwnProperty.call(CONFIG.tierRank, engineHint)) return -1;
  return Number(CONFIG.tierRank[engineHint] || 0);
}

function shouldTreatAsBelowFloor(engineHint, floorEngineHint) {
  const floorRank = getEngineTierRank(floorEngineHint);
  const engineRank = getEngineTierRank(engineHint);
  if (floorRank < 0) return false;
  if (engineRank < 0) return true;
  return engineRank < floorRank;
}

function getModelFloorEngineHint(sessionState, fallbackEngineHint = CONFIG.modelFloor.stickyHighMinTier) {
  return sessionState?.modelFloorEngineHint || fallbackEngineHint || null;
}

function getExplicitEnginePrefix(text) {
  const normalized = normalizeText(text);
  const match = normalized.match(/^([a-z0-9-]+):\s*/i);
  if (!match) return null;
  const alias = String(match[1] || '').toLowerCase();
  const prefixMap = CONFIG.heuristics?.explicitPrefixToEngineHint || {};
  const engineHint = prefixMap[alias];
  if (!engineHint) return null;
  return { alias, engineHint };
}

function hasExplicitEnginePrefix(text) {
  return Boolean(getExplicitEnginePrefix(text));
}

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  ensureStateDir();
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, filePath);
}

function appendLog(line) {
  ensureStateDir();
  fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`);
}

function appendAlertLog(line) {
  ensureStateDir();
  fs.appendFileSync(ALERT_LOG_PATH, `${new Date().toISOString()} ${line}\n`);
}

function sleepMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const shared = new SharedArrayBuffer(4);
  const view = new Int32Array(shared);
  Atomics.wait(view, 0, 0, ms);
}

function stablePatchString(patch) {
  const entries = Object.entries(patch || {}).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(Object.fromEntries(entries));
}

function hashPatch(patch) {
  return crypto.createHash('sha1').update(stablePatchString(patch)).digest('hex');
}

function getPatchLockPath(sessionKey) {
  return path.join(PATCH_LOCKS_DIR, encodeURIComponent(String(sessionKey || 'unknown')));
}

function acquirePatchLock(sessionKey, staleMs = 2 * 60 * 1000) {
  ensureStateDir();
  fs.mkdirSync(PATCH_LOCKS_DIR, { recursive: true });
  const lockDir = getPatchLockPath(sessionKey);

  while (true) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({
        pid: process.pid,
        acquiredAt: Date.now(),
        sessionKey,
      }));
      return lockDir;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;

      let owner = null;
      try {
        owner = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
      } catch {}

      const acquiredAt = Number(owner?.acquiredAt || 0);
      if (!acquiredAt || (Date.now() - acquiredAt) > staleMs) {
        try {
          fs.rmSync(lockDir, { recursive: true, force: true });
          continue;
        } catch {}
      }

      sleepMs(125 + Math.floor(Math.random() * 125));
    }
  }
}

function releasePatchLock(lockDir) {
  if (!lockDir) return;
  try {
    fs.rmSync(lockDir, { recursive: true, force: true });
  } catch {}
}

function loadState() {
  const state = readJson(STATE_PATH, { version: 1, sessions: {} });
  if (!state || typeof state !== 'object') return { version: 1, sessions: {} };
  if (!state.sessions || typeof state.sessions !== 'object') state.sessions = {};
  state.sessions = Object.fromEntries(
    Object.entries(state.sessions).map(([sessionKey, sessionState]) => [
      sessionKey,
      normalizeSessionState(sessionState || {}),
    ]),
  );
  pruneState(state);
  return state;
}

function saveState(state) {
  writeJsonAtomic(STATE_PATH, state);
}

function pruneState(state) {
  const cutoff = Date.now() - CONFIG.keepStateDays * 24 * 60 * 60 * 1000;
  const entries = Object.entries(state.sessions || {}).filter(([, value]) => {
    const updatedAt = Number(value?.updatedAt || value?.lastAppliedAt || value?.manualUntil || 0);
    return updatedAt >= cutoff;
  });
  entries.sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0));
  state.sessions = Object.fromEntries(entries.slice(0, CONFIG.keepMaxSessions));
}

function normalizeSender(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const value = raw.trim();
  if (!value) return '';
  const tail = value.includes(':') ? value.split(':').pop() : value;
  return String(tail || '').trim().toUpperCase();
}

const TIER_COMPARISON_REF_PATTERN = /\b(?:A0|A1|A|B|C)\b/i;
const TIER_COMPARISON_TRIGGER_PATTERN = /(?:比较|区别|contrast|compare|difference)/i;

function normalizeText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksTierComparison(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return TIER_COMPARISON_TRIGGER_PATTERN.test(normalized) && TIER_COMPARISON_REF_PATTERN.test(normalized);
}

function isDirectSession(sessionKey) {
  return typeof sessionKey === 'string' && sessionKey.includes(':direct:');
}

function isCronSession(sessionKey) {
  return typeof sessionKey === 'string' && sessionKey.includes(':cron:');
}

function isSubagentSession(sessionKey) {
  return typeof sessionKey === 'string' && sessionKey.includes(':subagent:');
}

function isSystemLikeSender(sender) {
  if (!sender) return false;
  return /^(?:SYSTEM|SYSTEMEVENT|SYS|OPENCLAW|CRON|HEARTBEAT)$/i.test(String(sender).trim());
}

function isSlashCommand(text) {
  return /^\s*\/\S+/.test(text);
}

function getRoutingSkipReason({ sessionKey, channel, sender, text }) {
  if (!sessionKey) return 'missing-session-key';
  if (isCronSession(sessionKey)) return 'cron-session';
  if (isSubagentSession(sessionKey)) return 'subagent-session';
  if (!isDirectSession(sessionKey)) return 'non-direct-session';
  if (channel && !CONFIG.enabledChannels.has(channel)) return 'channel-not-enabled';
  if (!sender) return 'missing-sender';
  if (isSystemLikeSender(sender)) return 'system-sender';
  if (CONFIG.allowedSenders && !CONFIG.allowedSenders.has(sender)) return 'sender-not-allowed';
  if (!text) return 'empty-text';
  return null;
}

function parseManualThinkingDirective(text) {
  const normalized = normalizeText(text);
  const match = normalized.match(/^\/(?:thinking|think|t)(?::|\s+)?(high|medium|low)?\b/i);
  if (!match) return null;
  return {
    command: match[0],
    level: match[1] ? match[1].toLowerCase() : null,
  };
}

function parseManualModelDirective(text) {
  const normalized = normalizeText(text);
  const match = normalized.match(/^\/model\s+([^\s]+)\s*$/i);
  if (!match) return null;
  const model = match[1].trim();
  if (!model) return null;
  return {
    command: match[0],
    model,
  };
}

function rank(level) {
  return LEVEL_RANK[level] || 0;
}

function pushReason(reasons, reason) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function detectExplicitLevel(text) {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  const levels = CONFIG.heuristics?.explicitLevel;
  if (levels?.high?.test(normalized)) return 'high';
  if (levels?.medium?.test(normalized)) return 'medium';
  if (levels?.low?.test(normalized)) return 'low';
  return null;
}

function isConfigMutationTask(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  const heuristics = CONFIG.heuristics?.configMutation;
  if (!heuristics) return false;
  const { configSurface, mutationVerb, imperative } = heuristics;
  if (!configSurface || !mutationVerb || !imperative) return false;

  return configSurface.test(normalized) && mutationVerb.test(normalized) && imperative.test(normalized);
}

function detectIntent(text) {
  const normalized = normalizeText(text);
  if (!normalized) return 'neutral';

  if (isConfigMutationTask(normalized)) {
    return 'execute';
  }

  const intents = CONFIG.heuristics?.intent;
  if (!intents) return 'neutral';

  const explainLead = intents.explainLead?.test(normalized);
  const draftLead = intents.draftLead?.test(normalized);
  const inspectLead = intents.inspectLead?.test(normalized);
  const imperativeLead = intents.imperativeLead?.test(normalized);

  if ((explainLead || draftLead || inspectLead) && !imperativeLead) {
    return 'explain';
  }

  const explain = intents.explain?.test(normalized);
  const storeRecord = intents.storeRecord?.test(normalized);
  const execute = storeRecord || intents.execute?.test(normalized);

  if (explain && execute) return 'mixed';
  if (execute) return 'execute';
  if (explain) return 'explain';
  return 'neutral';
}

function detectRiskProfile(text) {
  const domains = [];
  const riskHeuristics = CONFIG.heuristics?.risk || { patterns: [], tradingStatusOnly: null };
  const isTradingStatusOnly = riskHeuristics.tradingStatusOnly?.test(text.trim());

  for (const entry of riskHeuristics.patterns) {
    const pattern = entry.pattern;
    const domain = entry.domain;
    if (!pattern) continue;
    if (pattern.test(text)) {
      if (domain === 'trading-risk' && isTradingStatusOnly) continue;
      domains.push(domain);
    }
  }

  return {
    domains,
    hasRisk: domains.length > 0,
    hasCriticalRisk: domains.some((domain) => domain !== 'destructive-risk'),
    hasDestructiveRisk: domains.includes('destructive-risk'),
  };
}

function detectComplexity(text) {
  let score = 0;
  const reasons = [];
  const complexityHeuristics = CONFIG.heuristics?.complexity || [];

  for (const entry of complexityHeuristics) {
    if (entry.pattern?.test(text)) {
      score += Number(entry.weight) || 0;
      if (entry.reason) pushReason(reasons, entry.reason);
    }
  }

  if (text.length >= 160) {
    score += 1;
    pushReason(reasons, 'longer-request');
  }

  return { score, reasons };
}

function isVeryShortStandaloneQA(text, classified = {}, sessionState = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (normalized.length > 40) return false;

  const lastAppliedAt = Number(sessionState?.lastAppliedAt || 0);
  const lastAppliedLevel = sessionState?.lastAppliedLevel || null;
  if (lastAppliedAt && (Date.now() - lastAppliedAt) < 30 * 60 * 1000 && (lastAppliedLevel === 'medium' || lastAppliedLevel === 'high')) {
    return false;
  }

  const riskDomains = Array.isArray(classified?.riskDomains) ? classified.riskDomains : [];
  const intent = classified?.intent || 'neutral';
  const complexityScore = Number(classified?.complexityScore || 0);

  if (riskDomains.length > 0) return false;
  if (intent === 'execute' || intent === 'mixed') return false;
  if (complexityScore >= 2) return false;
  if (hasExplicitEnginePrefix(normalized)) return false;
  if (/^\//.test(normalized)) return false;

  const questionHeuristics = CONFIG.heuristics?.question;
  const shortQuestionPattern = questionHeuristics?.shortQuestion;
  const disqualifyContextPattern = questionHeuristics?.disqualifyContext;

  if (disqualifyContextPattern?.test(normalized)) return false;
  return Boolean(shortQuestionPattern?.test(normalized));
}

function looksContextHeavyFollowup(text) {
  return Boolean(CONFIG.heuristics?.contextHeavyFollowup?.test(text));
}

function loadSessionIndex() {
  return readJson(SESSION_INDEX_PATH, {});
}

function getSessionFilePath(sessionKey) {
  const index = loadSessionIndex();
  const entry = index?.[sessionKey];
  if (!entry || typeof entry !== 'object') return null;
  const file = typeof entry.sessionFile === 'string' ? entry.sessionFile : '';
  if (file && fs.existsSync(file)) return file;
  const sessionId = typeof entry.sessionId === 'string' ? entry.sessionId : '';
  if (!sessionId) return null;
  const candidate = path.join(AGENT_SESSIONS_DIR, `${sessionId}.jsonl`);
  return fs.existsSync(candidate) ? candidate : null;
}

function extractTextContent(message = {}) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}


function readRecentAssistantContext(sessionKey) {
  const filePath = getSessionFilePath(sessionKey);
  if (!filePath) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return null;
    const lines = raw.split('\n');
    const recentAssistantMessages = [];

    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (recentAssistantMessages.length >= CONFIG.assistantContextScanMessages) break;
      const line = lines[i];
      if (!line) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj?.type !== 'message') continue;
      const msg = obj?.message || {};
      if (msg.role !== 'assistant') continue;
      const text = extractTextContent(msg);
      if (!text) continue;
      recentAssistantMessages.push({
        text,
        timestamp: obj.timestamp || msg.timestamp || null,
        seenMessagesBack: recentAssistantMessages.length + 1,
      });
    }

    if (recentAssistantMessages.length === 0) return null;

    const matched = recentAssistantMessages.find((item) => detectAssistantRequestKind(item.text));
    const selected = matched || recentAssistantMessages[0];
    return {
      ...selected,
      requestKind: detectAssistantRequestKind(selected.text),
      scannedAssistantMessages: recentAssistantMessages.length,
    };
  } catch {
    return null;
  }
}

function detectAssistantRequestKind(text) {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  const heuristics = CONFIG.heuristics?.assistantRequest;
  if (!heuristics) return null;

  if (heuristics.actionRequest?.test(normalized)) {
    return 'action-request';
  }
  if (heuristics.decisionRequest?.test(normalized)) {
    return 'decision-request';
  }
  if (heuristics.statusRequest?.test(normalized)) {
    return 'status-request';
  }
  return null;
}

function isLikelyActionConfirmation(text) {
  const normalized = normalizeText(text);
  if (!normalized || normalized.length > 32) return false;
  const pattern = CONFIG.heuristics?.followup?.actionConfirmation;
  return Boolean(pattern?.test(normalized));
}

function isLikelyStatusUpdate(text) {
  const normalized = normalizeText(text);
  if (!normalized || normalized.length > 48) return false;
  const pattern = CONFIG.heuristics?.followup?.statusUpdate;
  return Boolean(pattern?.test(normalized));
}

function isLikelyThreadMetaQuestion(text) {
  const normalized = normalizeText(text);
  if (!normalized || normalized.length > 64) return false;
  const pattern = CONFIG.heuristics?.followup?.threadMetaQuestion;
  return Boolean(pattern?.test(normalized));
}

function isLikelyDecisionAck(text) {
  const normalized = normalizeText(text);
  if (!normalized || normalized.length > 24) return false;
  const pattern = CONFIG.heuristics?.followup?.decisionAck;
  return Boolean(pattern?.test(normalized));
}

function isLikelyThreadReferentialFollowup(text) {
  const normalized = normalizeText(text);
  if (!normalized || normalized.length > 64) return false;
  const pattern = CONFIG.heuristics?.followup?.referentialFollowup;
  return Boolean(pattern?.test(normalized));
}

function shouldEnableDiagnosticSticky(text, classified = {}) {
  const normalized = normalizeText(text);
  const reasons = Array.isArray(classified?.reasons) ? classified.reasons : [];
  const riskDomains = Array.isArray(classified?.riskDomains) ? classified.riskDomains : [];
  const complexityScore = Number(classified?.complexityScore || 0);
  if (riskDomains.includes('ops-risk') || riskDomains.includes('security-risk')) return true;
  if (reasons.includes('system-mechanics')) return true;
  if (complexityScore >= 2) return true;
  const pattern = CONFIG.heuristics?.diagnosticSticky;
  return Boolean(pattern?.test(normalized));
}

function isDiagnosticStickyActive(sessionState, now) {
  return Number(sessionState?.diagnosticUntil || 0) > now;
}

function isA0WordingTask(text, classified = {}) {
  const riskDomains = Array.isArray(classified?.riskDomains) ? classified.riskDomains : [];
  const intent = classified?.intent || 'neutral';
  if (riskDomains.length > 0) return false;
  if (intent === 'execute' || intent === 'mixed') return false;

  const pattern = CONFIG.heuristics?.tiers?.a0?.wordingTask;
  return Boolean(pattern?.test(text));
}

function isA0HardTranslationTask(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  const pattern = CONFIG.heuristics?.tiers?.a0?.hardTranslation;
  return Boolean(pattern?.test(normalized));
}

function isA0OneLinerExplainTask(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  const pattern = CONFIG.heuristics?.tiers?.a0?.oneLinerExplain;
  return Boolean(pattern?.test(normalized));
}

function isA1StandaloneTask(text, classified = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  const riskDomains = Array.isArray(classified?.riskDomains) ? classified.riskDomains : [];
  const intent = classified?.intent || 'neutral';
  const complexityScore = Number(classified?.complexityScore || 0);
  const tiersA1 = CONFIG.heuristics?.tiers?.a1;

  if (riskDomains.length > 0) return false;
  if (intent === 'execute' || intent === 'mixed') return false;
  if (looksContextHeavyFollowup(normalized)) return false;
  if (tiersA1?.exclude?.test(normalized)) return false;
  if (tiersA1?.excludeLeads?.test(normalized)) return false;
  if (complexityScore >= 3) return false;

  if (looksTierComparison(normalized)) return false;
  const includePattern = tiersA1?.include;
  if (!includePattern) return false;

  return includePattern.test(normalized);
}

function isLightweightContextEdit(text, classified = {}) {
  const normalized = normalizeText(text);
  const riskDomains = Array.isArray(classified?.riskDomains) ? classified.riskDomains : [];
  if (!normalized) return false;
  if (riskDomains.length > 0) return false;
  if (!looksContextHeavyFollowup(normalized)) return false;

  const pattern = CONFIG.heuristics?.tiers?.a?.lightweightEdit;
  return Boolean(pattern?.test(normalized));
}

function isBNormalExecutionTask(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  const pattern = CONFIG.heuristics?.tiers?.b?.normalExecution;
  return Boolean(pattern?.test(normalized));
}

function isCriticalStateChangingRequest(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  const pattern = CONFIG.heuristics?.tiers?.c?.criticalStateChange;
  return Boolean(pattern?.test(normalized));
}

function isLikelyContextFollowup(text, classified = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (normalized.length > 48) return false;
  if (/^\//.test(normalized)) return false;
  if (hasExplicitEnginePrefix(normalized)) return false;

  if (classified?.explicitLevel) return false;

  const followupPattern = CONFIG.heuristics?.followup?.contextFollowup;

  if (followupPattern?.test(normalized)) return true;
  if (isLikelyActionConfirmation(normalized)) return true;
  if (isLikelyStatusUpdate(normalized)) return true;
  if (isLikelyThreadReferentialFollowup(normalized)) return true;
  return looksContextHeavyFollowup(normalized);
}

function shouldCarryContextFollowup({ sessionState, text, classified, now, assistantContext }) {
  const anchorLevel = sessionState?.contextAnchorLevel || sessionState?.lastAppliedLevel || null;
  const anchorAt = Number(sessionState?.contextAnchorAt || sessionState?.lastAppliedAt || 0);
  const stickyUntil = Number(sessionState?.stickyUntil || 0);
  const diagnosticUntil = Number(sessionState?.diagnosticUntil || 0);
  const carryUntil = Math.max(stickyUntil, diagnosticUntil, anchorAt + CONFIG.contextCarryMinutes * 60 * 1000);
  const assistantRequestKind = assistantContext?.requestKind || null;
  const followup = isLikelyContextFollowup(text, classified);
  const actionConfirmation = isLikelyActionConfirmation(text);
  const statusUpdate = isLikelyStatusUpdate(text);
  const decisionAck = isLikelyDecisionAck(text);
  const referentialFollowup = isLikelyThreadReferentialFollowup(text);

  if (!anchorLevel || !LEVEL_RANK[anchorLevel]) {
    return { carry: false, reason: 'no-anchor-level', assistantRequestKind };
  }

  const actionDrivenCarry = (
    (assistantRequestKind === 'action-request' && (actionConfirmation || statusUpdate || decisionAck)) ||
    (assistantRequestKind === 'decision-request' && decisionAck) ||
    (assistantRequestKind === 'status-request' && (statusUpdate || followup))
  );

  if (!followup && !actionDrivenCarry && !(isDiagnosticStickyActive(sessionState, now) && (actionConfirmation || statusUpdate || decisionAck || referentialFollowup))) {
    return { carry: false, reason: 'not-followup', assistantRequestKind };
  }

  if (!anchorAt || now > carryUntil) {
    return { carry: false, reason: 'followup-window-expired', assistantRequestKind };
  }

  let carryReason = 'context-followup-no-rollback';
  if (actionDrivenCarry) carryReason = `assistant-${assistantRequestKind}`;
  else if (isDiagnosticStickyActive(sessionState, now) && (actionConfirmation || statusUpdate || decisionAck)) carryReason = 'diagnostic-sticky-followup';
  else if (actionConfirmation) carryReason = 'action-confirmation-followup';
  else if (statusUpdate) carryReason = 'status-update-followup';
  else if (decisionAck) carryReason = 'decision-ack-followup';
  else if (referentialFollowup) carryReason = 'referential-followup';

  return {
    carry: true,
    reason: carryReason,
    level: anchorLevel,
    engineHint: sessionState?.contextAnchorEngineHint || sessionState?.lastEngineHint || engineHintFromLevel(anchorLevel),
    assistantRequestKind,
    actionConfirmation,
    statusUpdate,
    decisionAck,
  };
}

function engineHintFromLevel(level) {
  return CONFIG.tierByLevel[level] || CONFIG.tiers.a;
}


function classifyEngineRoute(rawText, classifiedThinking = {}, options = {}) {
  const text = normalizeText(rawText);
  const intent = classifiedThinking?.intent || 'neutral';
  const riskDomains = Array.isArray(classifiedThinking?.riskDomains) ? classifiedThinking.riskDomains : [];
  const complexityScore = Number(classifiedThinking?.complexityScore || 0);
  const assistantRequestKind = options?.assistantContext?.requestKind || null;
  const diagnosticSticky = Boolean(options?.diagnosticSticky);
  const hasAnchor = Boolean(options?.hasAnchor);
  const explicitPrefix = getExplicitEnginePrefix(text);

  if (classifiedThinking?.explicitLevel === 'high') {

    return { engineHint: CONFIG.tiers.c, reasons: ['explicit-high-force-c-tier'] };
  }

  if (explicitPrefix) {
    return { engineHint: explicitPrefix.engineHint, reasons: [`explicit-${explicitPrefix.alias}-prefix`] };
  }

  if (isLikelyThreadMetaQuestion(text)) {
    return {
      engineHint: diagnosticSticky ? CONFIG.tiers.b : (hasAnchor ? CONFIG.tiers.a : CONFIG.tiers.a0),
      reasons: ['thread-meta-question-route'],
    };
  }

  if (isLikelyThreadReferentialFollowup(text) && (hasAnchor || diagnosticSticky || assistantRequestKind)) {
    return { engineHint: diagnosticSticky ? CONFIG.tiers.b : CONFIG.tiers.a, reasons: ['thread-referential-followup-route', assistantRequestKind || 'no-assistant-request'] };
  }

  if (isLikelyActionConfirmation(text)) {
    return { engineHint: diagnosticSticky ? CONFIG.tiers.b : CONFIG.tiers.a, reasons: ['action-confirmation-route', assistantRequestKind || 'no-assistant-request'] };
  }

  if (isLikelyStatusUpdate(text)) {
    return { engineHint: diagnosticSticky ? CONFIG.tiers.b : CONFIG.tiers.a, reasons: ['status-update-route', assistantRequestKind || 'no-assistant-request'] };
  }

  if (isLikelyDecisionAck(text)) {
    // If assistant asked about executing something (action-request/decision-request) AND
    // there's a risk context (trading/ops), treat "好的" as approval-to-execute → B tier
    const riskDomains = Array.isArray(options?.classified?.riskDomains) ? options.classified.riskDomains : [];
    const hasRiskContext = riskDomains.length > 0 || diagnosticSticky;
    const isApprovalToExecute = (assistantRequestKind === 'action-request' || assistantRequestKind === 'decision-request') && hasRiskContext;
    return {
      engineHint: isApprovalToExecute
        ? CONFIG.tiers.b
        : (assistantRequestKind === 'decision-request' || hasAnchor || diagnosticSticky)
          ? (diagnosticSticky ? CONFIG.tiers.b : CONFIG.tiers.a)
          : CONFIG.tiers.a0,
      reasons: ['decision-ack-route', assistantRequestKind || 'no-assistant-request'],
    };
  }

  // Only intercept as context-heavy followup when there is an active anchor or diagnostic context.
  // Without an anchor (new thread), looksContextHeavyFollowup can falsely match standalone questions
  // (e.g. "今天西雅图怎么样") because of broad patterns like "怎么". Fix: require hasAnchor || diagnosticSticky.
  if ((looksContextHeavyFollowup(text) && (hasAnchor || diagnosticSticky)) || (isLikelyContextFollowup(text, classifiedThinking) && (assistantRequestKind || diagnosticSticky || hasAnchor))) {
    return { engineHint: diagnosticSticky ? CONFIG.tiers.b : CONFIG.tiers.a, reasons: ['followup-pre-a0-route', assistantRequestKind || 'no-assistant-request'] };
  }

  if (isVeryShortStandaloneQA(text, classifiedThinking, options?.sessionState)) {
    return {
      engineHint: diagnosticSticky ? CONFIG.tiers.b : CONFIG.tiers.a0,
      reasons: ['a0-hard-route-very-short-qa'],
    };
  }

  if (isA0HardTranslationTask(text) || isA0OneLinerExplainTask(text)) {
    return { engineHint: CONFIG.tiers.a0, reasons: ['a0-hard-coverage-route'] };
  }

  if (isA0WordingTask(text, classifiedThinking)) {
    return { engineHint: CONFIG.tiers.a0, reasons: ['a0-wording-route'] };
  }

  if (isA1StandaloneTask(text, classifiedThinking)) {
    return { engineHint: CONFIG.tiers.a1, reasons: ['a1-standalone-route'] };
  }

  if (riskDomains.length > 0) {
    if (classifiedThinking?.level === 'high') {
      return { engineHint: CONFIG.tiers.c, reasons: ['risk-domain-present', 'c-tier-route-explicit', ...riskDomains] };
    }
    if (classifiedThinking?.level === 'medium') {
      return { engineHint: CONFIG.tiers.b, reasons: ['risk-domain-present', 'b-tier-route-explicit', ...riskDomains] };
    }
    return { engineHint: CONFIG.tiers.a, reasons: ['risk-domain-present', 'a-tier-route-explicit', ...riskDomains] };
  }

  if (classifiedThinking?.level === 'high') {
    return { engineHint: CONFIG.tiers.c, reasons: ['c-tier-route-explicit'] };
  }

  if (classifiedThinking?.level === 'medium') {
    return { engineHint: CONFIG.tiers.b, reasons: ['b-tier-route-explicit'] };
  }

  if (intent === 'execute' || intent === 'mixed') {
    return { engineHint: CONFIG.tiers.passthrough, reasons: ['execute-intent'] };
  }

  if (complexityScore >= 3) {
    return { engineHint: CONFIG.tiers.passthrough, reasons: ['high-complexity-main'] };
  }

  if (intent === 'explain' || intent === 'neutral') {
    const routeOverride = CONFIG.heuristics?.routeOverride;
    const systemDomainExplainPattern = routeOverride?.systemDomainExplain;
    const debugAuditPattern = routeOverride?.debugAuditTask;

    // System/config-domain explain questions should not fall to A0 — route to B
    if (systemDomainExplainPattern?.test(text)) {
      return {
        engineHint: CONFIG.tiers.b,
        reasons: ['system-domain-explain-b-route'],
      };
    }
    // Longer debug/fix/audit tasks (len>30) should not fall to A0 — route to A minimum
    if (text.length > 30 && debugAuditPattern?.test(text)) {
      return {
        engineHint: CONFIG.tiers.a,
        reasons: ['debug-audit-task-a-route'],
      };
    }
    // When diagnostic sticky is active, don't fall to Gemini — hold at a-main minimum
    return {
      engineHint: diagnosticSticky ? CONFIG.tiers.a : CONFIG.tiers.a0,
      reasons: ['fallback-a0-auto'],
    };
  }

  return { engineHint: CONFIG.tiers.passthrough, reasons: ['default-main'] };
}

function classifyThinkingLevel(rawText) {
  const text = normalizeText(rawText);
  const reasons = [];

  if (!text) return { level: null, reasons: ['empty'] };

  const explicitLevel = detectExplicitLevel(text);
  const intent = detectIntent(text);
  const risk = detectRiskProfile(text);
  const complexity = detectComplexity(text);
  const configMutation = isConfigMutationTask(text);

  if (explicitLevel) pushReason(reasons, `explicit-${explicitLevel}`);
  if (intent !== 'neutral') pushReason(reasons, `intent-${intent}`);
  if (configMutation) pushReason(reasons, 'config-mutation');
  for (const domain of risk.domains) pushReason(reasons, domain);
  for (const reason of complexity.reasons) pushReason(reasons, reason);

  const a0HardCoverage = isA0HardTranslationTask(text) || isA0OneLinerExplainTask(text);
  const a1Standalone = isA1StandaloneTask(text, { intent, riskDomains: risk.domains, complexityScore: complexity.score });
  const lightweightContextEdit = isLightweightContextEdit(text, { riskDomains: risk.domains });
  const bNormalExecution = isBNormalExecutionTask(text);
  const criticalStateChange = isCriticalStateChangingRequest(text);
  const threadMetaQuestion = isLikelyThreadMetaQuestion(text);

  const highRiskExecute =
    criticalStateChange ||
    configMutation ||
    ((risk.hasDestructiveRisk && intent !== 'explain') ||
    (risk.hasCriticalRisk && (intent === 'execute' || intent === 'mixed')));

  if (explicitLevel === 'high') {
    return { level: 'high', reasons, explicitLevel, intent, riskDomains: risk.domains, complexityScore: complexity.score };
  }

  const systemExplainPattern = CONFIG.heuristics?.routeOverride?.systemDomainExplain;
  if (systemExplainPattern?.test(text) && (intent === 'explain' || intent === 'neutral')) {
    pushReason(reasons, 'system-domain-explain');
    return { level: 'medium', reasons, explicitLevel, intent, riskDomains: risk.domains, complexityScore: complexity.score };
  }

  if (a0HardCoverage) {
    pushReason(reasons, 'a0-hard-coverage');
    return { level: 'low', reasons, explicitLevel, intent, riskDomains: [], complexityScore: 0 };
  }

  if (lightweightContextEdit) {
    pushReason(reasons, 'lightweight-context-edit');
    return { level: 'low', reasons, explicitLevel, intent, riskDomains: risk.domains, complexityScore: complexity.score };
  }

  if (highRiskExecute) {
    pushReason(reasons, configMutation ? 'config-mutation-high-risk' : (criticalStateChange ? 'critical-state-change' : 'high-risk-execute'));
    return { level: 'high', reasons, explicitLevel, intent, riskDomains: risk.domains, complexityScore: complexity.score };
  }

  if (explicitLevel === 'low') {
    return { level: 'low', reasons, explicitLevel, intent, riskDomains: risk.domains, complexityScore: complexity.score };
  }

  if (explicitLevel === 'medium') {
    return { level: 'medium', reasons, explicitLevel, intent, riskDomains: risk.domains, complexityScore: complexity.score };
  }

  if (risk.hasRisk && (intent === 'explain' || intent === 'analyze')) {
    pushReason(reasons, 'risk-explain');
    return { level: 'medium', reasons, explicitLevel, intent, riskDomains: risk.domains, complexityScore: complexity.score };
  }

  if (risk.hasRisk && intent === 'neutral') {
    pushReason(reasons, 'risk-neutral');
    return { level: 'medium', reasons, explicitLevel, intent, riskDomains: risk.domains, complexityScore: complexity.score };
  }

  if (threadMetaQuestion) {
    pushReason(reasons, 'thread-meta-question');
    return { level: 'medium', reasons, explicitLevel, intent, riskDomains: risk.domains, complexityScore: complexity.score };
  }

  if (bNormalExecution) {
    pushReason(reasons, 'b-normal-execution');
    return { level: 'medium', reasons, explicitLevel, intent, riskDomains: risk.domains, complexityScore: complexity.score };
  }

  if (a1Standalone && !risk.hasRisk && intent !== 'execute' && intent !== 'mixed') {
    pushReason(reasons, 'a1-standalone-low');
    return { level: 'low', reasons, explicitLevel, intent, riskDomains: risk.domains, complexityScore: complexity.score };
  }

  if (complexity.score >= 2) {
    return { level: 'medium', reasons, explicitLevel, intent, riskDomains: risk.domains, complexityScore: complexity.score };
  }

  if (intent === 'execute' || intent === 'mixed') {
    pushReason(reasons, 'execute-default-medium');
    return { level: 'medium', reasons, explicitLevel, intent, riskDomains: risk.domains, complexityScore: complexity.score };
  }

  return {
    level: 'low',
    reasons: reasons.length ? reasons : ['default-low'],
    explicitLevel,
    intent,
    riskDomains: risk.domains,
    complexityScore: complexity.score,
  };
}

function shouldSkipForManual(sessionState, now) {
  return Number(sessionState?.manualUntil || 0) > now;
}

function isModelHoldActive(sessionState, now) {
  return Number(sessionState?.modelHoldUntil || 0) > now;
}

function getHeldEngineHint(sessionState) {
  return getModelFloorEngineHint(sessionState, CONFIG.modelFloor.stickyHighMinTier);
}

function getHeldModel(sessionState) {
  // If user set a model directly via /model (no engineHint), return it as-is without tier lookup.
  if (sessionState?.modelFloorModel && !sessionState?.modelFloorEngineHint) {
    return sessionState.modelFloorModel;
  }
  const heldEngineHint = getHeldEngineHint(sessionState);
  const configuredModel = resolveConfiguredModelSelection(heldEngineHint, sessionState)?.model;
  if (configuredModel !== undefined) return configuredModel;
  return sessionState?.modelFloorModel || null;
}

function computeStickyUntil(level, now) {
  const minutes = CONFIG.stickyMinutes[level];
  if (!minutes) return 0;
  return now + minutes * 60 * 1000;
}

function computeLowAllowedAfter(level, now, previousState = {}) {
  if (level === 'high') {
    return now + CONFIG.lowAllowedAfterMinutes.high * 60 * 1000;
  }
  if (level === 'medium') {
    return Math.max(Number(previousState?.lowAllowedAfter || 0), 0);
  }
  return 0;
}

function normalizeSessionState(sessionState = {}) {
  const next = { ...sessionState };
  const lastAppliedLevel = next.lastAppliedLevel;
  const lastAppliedAt = Number(next.lastAppliedAt || 0);

  if (!LEVEL_RANK[lastAppliedLevel] || !lastAppliedAt) return next;

  const stickyCap = computeStickyUntil(lastAppliedLevel, lastAppliedAt);
  if (!Number.isFinite(Number(next.stickyUntil)) || Number(next.stickyUntil || 0) > stickyCap) {
    next.stickyUntil = stickyCap;
  }

  if (lastAppliedLevel === 'high') {
    const lowFloor = computeLowAllowedAfter('high', lastAppliedAt, next);
    if (!Number.isFinite(Number(next.lowAllowedAfter)) || Number(next.lowAllowedAfter || 0) < lowFloor) {
      next.lowAllowedAfter = lowFloor;
    }
  }

  if (!next.contextAnchorLevel || !LEVEL_RANK[next.contextAnchorLevel]) {
    next.contextAnchorLevel = lastAppliedLevel;
  }
  if (!next.contextAnchorEngineHint) {
    next.contextAnchorEngineHint = next.lastEngineHint || engineHintFromLevel(next.contextAnchorLevel);
  }
  if (!Number(next.contextAnchorAt || 0)) {
    next.contextAnchorAt = lastAppliedAt;
  }
  if (!Number.isFinite(Number(next.diagnosticUntil || 0))) {
    next.diagnosticUntil = 0;
  }
  if (!Number.isFinite(Number(next.modelHoldUntil || 0))) {
    next.modelHoldUntil = 0;
  }
  if (!next.modelFloorEngineHint && next.modelFloorModel) {
    next.modelFloorEngineHint = null;
  }
  if (typeof next.modelPoolId !== 'string') {
    next.modelPoolId = getStickyModelPoolId(next) || '';
  }
  if (!next.modelPoolByTier || typeof next.modelPoolByTier !== 'object') {
    next.modelPoolByTier = {};
  } else {
    next.modelPoolByTier = { ...next.modelPoolByTier };
  }
  if (typeof next.pendingPatchHash !== 'string') {
    next.pendingPatchHash = '';
  }
  if (typeof next.lastAppliedPatchHash !== 'string') {
    next.lastAppliedPatchHash = '';
  }

  return next;
}

function shouldPatchLevel({ sessionState, targetLevel, now }) {
  const lastAppliedLevel = sessionState?.lastAppliedLevel || null;
  const lastAppliedAt = Number(sessionState?.lastAppliedAt || 0);
  const stickyUntil = Number(sessionState?.stickyUntil || 0);
  const lowAllowedAfter = Number(sessionState?.lowAllowedAfter || 0);

  if (!targetLevel) return { action: 'skip', why: 'no-target-level' };

  if (!lastAppliedLevel) {
    if (targetLevel === 'low') return { action: 'skip', why: 'default-low-no-patch-needed' };
    return { action: 'patch', level: targetLevel, why: 'escalate-from-default' };
  }

  if (lastAppliedLevel === targetLevel && now - lastAppliedAt < CONFIG.dedupeMinutes * 60 * 1000) {
    return { action: 'skip', why: 'recent-duplicate' };
  }

  if (rank(targetLevel) < rank(lastAppliedLevel)) {
    if (lastAppliedLevel === 'high' && targetLevel === 'low') {
      if (now < stickyUntil) return { action: 'skip', why: 'sticky-hold-high' };
      return { action: 'patch', level: 'medium', why: 'soft-decay-high-to-medium' };
    }

    if (targetLevel === 'low' && now < lowAllowedAfter) {
      return { action: 'skip', why: 'low-floor-active' };
    }

    if (now < stickyUntil) return { action: 'skip', why: 'sticky-hold' };
    return { action: 'patch', level: targetLevel, why: 'downgrade' };
  }

  if (rank(targetLevel) === rank(lastAppliedLevel)) {
    return { action: 'skip', why: 'already-at-target' };
  }

  return { action: 'patch', level: targetLevel, why: 'escalate' };
}

function sleepMs(ms) {
  const delay = Math.max(0, Number(ms) || 0);
  if (!delay) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
}

function patchSessionSync({ sessionKey, patch }) {
  const params = JSON.stringify({ key: sessionKey, ...patch });
  return execFileSync('openclaw', ['gateway', 'call', 'sessions.patch', '--params', params, '--timeout', '30000'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function patchSessionWithRetry({ sessionKey, patch }) {
  const attempts = Math.max(1, Number(CONFIG.patchRetry?.attempts || 1));
  const baseDelayMs = Math.max(100, Number(CONFIG.patchRetry?.baseDelayMs || 1000));
  const maxDelayMs = Math.max(baseDelayMs, Number(CONFIG.patchRetry?.maxDelayMs || 12000));
  const jitterMs = Math.max(0, Number(CONFIG.patchRetry?.jitterMs || 0));
  const initialDelayMs = Math.max(0, Number(CONFIG.patchRetry?.initialDelayMs || 500));

  // Small initial delay to let the gateway WS finish reconnecting before first attempt
  if (initialDelayMs > 0) sleepMs(initialDelayMs);

  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const output = patchSessionSync({ sessionKey, patch });
      return { ok: true, output, attemptsUsed: attempt };
    } catch (error) {
      lastError = error;
      const message = String(error?.stack || error || 'unknown-error');
      appendLog(`[thinking-router] patch-worker-retry session=${sessionKey} attempt=${attempt}/${attempts} patch=${JSON.stringify(patch)} error=${JSON.stringify(message).slice(0, 1200)}`);
      if (attempt >= attempts) break;
      const exp = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      const jitter = jitterMs ? Math.floor(Math.random() * (jitterMs + 1)) : 0;
      sleepMs(exp + jitter);
    }
  }

  return { ok: false, error: lastError, attemptsUsed: attempts };
}

function shouldPatchModel({ sessionState = {}, engineHint, now, explicitModelPrefix = false }) {
  let targetEngineHint = engineHint;
  let why = 'model-route-enforce';

  if (!explicitModelPrefix) {
    const stickyHighFloorTier = CONFIG.modelFloor.stickyHighMinTier;
    const heldEngineHint = getHeldEngineHint(sessionState);

    if (isModelHoldActive(sessionState, now)) {
      const heldModel = getHeldModel(sessionState);
      // Fix: when modelFloorEngineHint is null (e.g. user set a non-standard model via /model),
      // always enforce the held model directly, bypassing tier comparison.
      const useDirectHold = heldModel && !sessionState?.modelFloorEngineHint;
      if (useDirectHold || shouldTreatAsBelowFloor(engineHint, heldEngineHint)) {
        const currentModel = Object.prototype.hasOwnProperty.call(sessionState, 'lastModelOverride')
          ? sessionState.lastModelOverride
          : null;
        if (currentModel === heldModel) return { action: 'skip', why: 'model-already-at-target', model: heldModel, poolId: getStickyModelPoolId(sessionState), engineHint: heldEngineHint };
        return { action: 'patch', why: 'manual-model-hold-floor', model: heldModel, poolId: getStickyModelPoolId(sessionState), engineHint: heldEngineHint };
      }
    }

    if (
      sessionState?.lastAppliedLevel === 'high'
      && now < Number(sessionState?.stickyUntil || 0)
      && shouldTreatAsBelowFloor(engineHint, stickyHighFloorTier)
    ) {
      targetEngineHint = stickyHighFloorTier;
      why = 'sticky-high-model-floor';
    } else {
      // Soft model decay: only allow stepping down one tier at a time (mirrors thinking level soft-decay)
      const lastEngineHint = sessionState?.lastEngineHint || null;
      const lastTierRank = getEngineTierRank(lastEngineHint);
      const targetTierRank = getEngineTierRank(engineHint);

      if (lastTierRank > 0 && targetTierRank < lastTierRank - 1) {
        // Would skip more than one tier down — cap at one tier below last
        const tierEntries = Object.entries(CONFIG.tierRank).sort((a, b) => a[1] - b[1]);
        // Find the tier just below lastTierRank
        const decayedEntry = tierEntries.filter(([, r]) => r === lastTierRank - 1)[0];
        if (decayedEntry) {
          targetEngineHint = decayedEntry[0];
          why = 'soft-model-decay';
        }
      }
    }
  }

  const selection = resolveConfiguredModelSelection(targetEngineHint, sessionState);
  const targetModel = selection.model;

  const currentModel = Object.prototype.hasOwnProperty.call(sessionState, 'lastModelOverride')
    ? sessionState.lastModelOverride
    : null;

  if (targetModel === undefined || targetModel === null) {
    return { action: 'skip', why: 'passthrough-or-unknown-engine-hint', model: currentModel, poolId: selection.poolId || null, engineHint: targetEngineHint };
  }

  if (currentModel === targetModel) {
    return { action: 'skip', why: 'model-already-at-target', model: targetModel, poolId: selection.poolId || null, engineHint: targetEngineHint };
  }

  return { action: 'patch', why, model: targetModel, poolId: selection.poolId || null, engineHint: targetEngineHint };
}

function queuePatchSession({ sessionKey, patch }) {
  const child = spawn(process.execPath, [__filename, '--mode', 'apply-patch', '--session-key', sessionKey, '--patch-json', JSON.stringify(patch)], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  return { queued: true, pid: child.pid };
}

/**
 * Inline async patch — applies thinkingLevel + model BEFORE the agent turn starts.
 * Called from handleHookEvent (which must be async) right after routeThinking.
 *
 * Strategy:
 *  - thinkingLevel: write directly to sessions.json (atomic rename, microseconds)
 *  - model: write providerOverride + modelOverride directly to sessions.json (mirrors applyModelOverrideToSessionEntry; microseconds)
 *
 * This is NOT a replacement for the detached patch worker — the worker still runs
 * afterward as a reconciler to ensure /status reflects the change.
 */
async function inlinePatchSessionAsync({ sessionKey, patch }) {
  if (!patch || typeof patch !== 'object') return { ok: false, reason: 'no-patch' };

  const results = {};

  // --- 1. thinkingLevel: direct file patch (no IPC needed) ---
  if (patch.thinkingLevel) {
    try {
      const indexPath = SESSION_INDEX_PATH;
      const index = readJson(indexPath, {});
      const entry = index[sessionKey];
      if (entry && typeof entry === 'object') {
        entry.thinkingLevel = patch.thinkingLevel;
        entry.updatedAt = Date.now();
        writeJsonAtomic(indexPath, index);
        results.thinkingLevel = { ok: true, method: 'direct-file-write' };
        appendLog(`[thinking-router] inline-patch thinkingLevel=${patch.thinkingLevel} session=${sessionKey} method=direct-file-write`);
      } else {
        results.thinkingLevel = { ok: false, reason: 'session-not-in-index' };
        appendLog(`[thinking-router] inline-patch thinkingLevel SKIP session=${sessionKey} reason=session-not-in-index`);
      }
    } catch (err) {
      results.thinkingLevel = { ok: false, error: String(err?.message || err) };
      appendLog(`[thinking-router] inline-patch thinkingLevel ERROR session=${sessionKey} err=${String(err?.message || err).slice(0, 200)}`);
    }
  }

  // --- 2. model: direct file patch (mirrors applyModelOverrideToSessionEntry logic) ---
  // Strategy: write providerOverride + modelOverride directly to sessions.json (atomic rename, microseconds).
  // This mirrors what OpenClaw's applyModelOverrideToSessionEntry does:
  //   - non-default model: set providerOverride + modelOverride, delete runtime fields (model, modelProvider, contextTokens)
  //   - default model: delete providerOverride + modelOverride (and runtime fields)
  // The detached /tools/invoke worker still runs afterward as reconciler for /status visibility.
  if (patch.model !== undefined) {
    try {
      const t0 = Date.now();
      const modelStr = typeof patch.model === 'string' ? patch.model.trim() : '';
      // Parse "provider/model" format
      const slashIdx = modelStr.indexOf('/');
      const provider = slashIdx > 0 ? modelStr.slice(0, slashIdx).trim() : '';
      const modelId = slashIdx > 0 ? modelStr.slice(slashIdx + 1).trim() : modelStr;
      const isDefault = !modelStr; // empty string = reset to default

      const indexPath = SESSION_INDEX_PATH;
      const index = readJson(indexPath, {});
      const entry = index[sessionKey];
      if (entry && typeof entry === 'object') {
        if (isDefault) {
          // Reset to default: remove override fields
          delete entry.providerOverride;
          delete entry.modelOverride;
        } else {
          // Set override
          entry.providerOverride = provider || undefined;
          entry.modelOverride = modelId;
          if (!provider) delete entry.providerOverride;
        }
        // Always clear runtime fields — OpenClaw will repopulate on next run
        delete entry.model;
        delete entry.modelProvider;
        delete entry.contextTokens;
        // Clear stale fallback notice fields
        delete entry.fallbackNoticeSelectedModel;
        delete entry.fallbackNoticeActiveModel;
        delete entry.fallbackNoticeReason;
        entry.updatedAt = Date.now();
        writeJsonAtomic(indexPath, index);
        const ms = Date.now() - t0;
        results.model = { ok: true, method: 'direct-file-write', changedModel: true, ms };
        appendLog(`[thinking-router] inline-patch model=${JSON.stringify(patch.model)} session=${sessionKey} ok=true method=direct-file-write changedModel=true ms=${ms}`);
      } else {
        results.model = { ok: false, reason: 'session-not-in-index' };
        appendLog(`[thinking-router] inline-patch model SKIP session=${sessionKey} reason=session-not-in-index`);
      }
    } catch (err) {
      results.model = { ok: false, error: String(err?.message || err) };
      appendLog(`[thinking-router] inline-patch model ERROR session=${sessionKey} err=${String(err?.message || err).slice(0, 200)}`);
    }
  }

  return { ok: true, results };
}

function recordDesiredPatch({ state, sessionKey, patch, now }) {
  const sessionState = state.sessions?.[sessionKey] || {};
  state.sessions[sessionKey] = {
    ...sessionState,
    updatedAt: now,
    pendingPatchHash: hashPatch(patch),
    pendingPatch: patch,
    pendingPatchQueuedAt: now,
  };
}

function updateSessionState({
  state,
  sessionKey,
  sessionState,
  patchLevel,
  touchLevelState = false,
  resolvedModel,
  touchModelState = false,
  modelPoolId = null,
  modelEngineHint = null,
  engineHint,
  now,
  reasons,
  contextCarry,
  diagnosticSticky,
  assistantContext,
  setModelHold = false,
  modelFloorEngineHint = CONFIG.modelFloor.explicitHighHoldTier,
}) {
  const normalizedLevel = LEVEL_RANK[patchLevel] ? patchLevel : (sessionState?.lastAppliedLevel || 'low');

  const next = {
    ...sessionState,
    updatedAt: now,
    lastReasons: reasons,
    lastEngineHint: engineHint,
    lastAssistantRequestKind: assistantContext?.requestKind || null,
    lastAssistantContextAt: assistantContext?.timestamp || null,
    modelPoolId: getStickyModelPoolId(sessionState) || '',
    modelPoolByTier: sessionState?.modelPoolByTier && typeof sessionState.modelPoolByTier === 'object'
      ? { ...sessionState.modelPoolByTier }
      : {},
  };

  if (touchLevelState) {
    next.lastAppliedLevel = normalizedLevel;
    next.lastAppliedAt = now;
    next.stickyUntil = computeStickyUntil(normalizedLevel, now);
    next.lowAllowedAfter = computeLowAllowedAfter(normalizedLevel, now, sessionState);

    if (!contextCarry?.carry) {
      next.contextAnchorLevel = normalizedLevel;
      next.contextAnchorEngineHint = engineHint || engineHintFromLevel(normalizedLevel);
      next.contextAnchorAt = now;
    }
  }

  if (modelPoolId) {
    next.modelPoolId = modelPoolId;
    if (modelEngineHint) next.modelPoolByTier[modelEngineHint] = modelPoolId;
  }

  if (touchModelState) {
    next.lastModelOverride = resolvedModel;
  }

  if (diagnosticSticky) {
    next.diagnosticUntil = now + CONFIG.diagnosticStickyMinutes * 60 * 1000;
  }
  if (setModelHold) {
    next.modelHoldUntil = now + CONFIG.modelHoldMinutes * 60 * 1000;
    next.modelFloorEngineHint = modelFloorEngineHint || CONFIG.modelFloor.explicitHighHoldTier || null;
    next.modelFloorModel = resolvedModel ?? resolveConfiguredModelSelection(next.modelFloorEngineHint, next)?.model ?? next.modelFloorModel ?? null;
  }

  state.sessions[sessionKey] = next;
}

function markModelHold({ state, sessionKey, sessionState, now, note, model, engineHint = null }) {
  const next = {
    ...sessionState,
    updatedAt: now,
    lastManualNote: note,
    modelHoldUntil: now + CONFIG.modelHoldMinutes * 60 * 1000,
    modelFloorEngineHint: engineHint || null,
    modelFloorModel: model,
    lastModelOverride: model,
  };
  state.sessions[sessionKey] = next;
}

function markManualHold({ state, sessionKey, sessionState, now, note, level, model, engineHint = null }) {
  const next = {
    ...sessionState,
    manualUntil: now + CONFIG.manualHoldMinutes * 60 * 1000,
    updatedAt: now,
    lastManualNote: note,
  };

  if (model) {
    next.modelHoldUntil = now + CONFIG.modelHoldMinutes * 60 * 1000;
    next.modelFloorEngineHint = engineHint || null;
    next.modelFloorModel = model;
    next.lastModelOverride = model;
  }

  if (level && LEVEL_RANK[level]) {
    next.lastAppliedLevel = level;
    next.lastAppliedAt = now;
    next.stickyUntil = computeStickyUntil(level, now);
    next.lowAllowedAfter = computeLowAllowedAfter(level, now, sessionState);
    next.lastReasons = ['manual-directive'];
    next.contextAnchorLevel = level;
    next.contextAnchorEngineHint = engineHintFromLevel(level);
    next.contextAnchorAt = now;
    if (level === 'high' && !model) {
      next.modelHoldUntil = now + CONFIG.modelHoldMinutes * 60 * 1000;
      next.modelFloorEngineHint = CONFIG.modelFloor.explicitHighHoldTier || CONFIG.tiers.c;
      next.modelFloorModel = resolveConfiguredModelSelection(next.modelFloorEngineHint, next)?.model ?? next.modelFloorModel ?? null;
    }
  }

  state.sessions[sessionKey] = next;
}

function routeThinking(input, options = {}) {
  const now = Date.now();
  const dryRun = Boolean(options.dryRun);
  const sessionKey = String(input?.sessionKey || '').trim();
  const channel = String(input?.channel || '').trim().toLowerCase();
  const sender = normalizeSender(input?.senderId || input?.from || '');
  const text = normalizeText(input?.text || input?.content || '');

  const skipReason = getRoutingSkipReason({ sessionKey, channel, sender, text });
  if (skipReason) {
    appendLog(`[thinking-router] skip reason=${skipReason} session=${sessionKey || 'none'} sender=${sender || 'unknown'} channel=${channel || 'unknown'} blocked=thinking,model`);
    return { ok: true, skipped: true, reason: skipReason };
  }

  const state = loadState();
  const sessionState = state.sessions[sessionKey] || {};
  const assistantContext = readRecentAssistantContext(sessionKey);
  if (assistantContext) assistantContext.requestKind = detectAssistantRequestKind(assistantContext.text);
  const manualDirective = parseManualThinkingDirective(text);
  const manualModelDirective = parseManualModelDirective(text);

  if (manualDirective) {
    markManualHold({
      state,
      sessionKey,
      sessionState,
      now,
      note: 'explicit-thinking-directive',
      level: manualDirective.level,
    });
    if (!dryRun) saveState(state);
    appendLog(`[thinking-router] manual hold session=${sessionKey} sender=${sender || 'unknown'} note=explicit-thinking-directive level=${manualDirective.level || 'unspecified'}`);
    return {
      ok: true,
      skipped: true,
      reason: 'manual-thinking-directive',
      manualLevel: manualDirective.level,
    };
  }

  if (manualModelDirective) {
    markModelHold({
      state,
      sessionKey,
      sessionState,
      now,
      note: 'explicit-model-directive',
      model: manualModelDirective.model,
    });
    if (!dryRun) saveState(state);
    appendLog(`[thinking-router] manual hold session=${sessionKey} sender=${sender || 'unknown'} note=explicit-model-directive model=${manualModelDirective.model}`);
    return {
      ok: true,
      skipped: true,
      reason: 'manual-model-directive',
      manualModel: manualModelDirective.model,
    };
  }

  if (isSlashCommand(text)) {
    appendLog(`[thinking-router] skip reason=slash-command session=${sessionKey} text=${JSON.stringify(text).slice(0, 180)}`);
    return { ok: true, skipped: true, reason: 'slash-command' };
  }

  if (shouldSkipForManual(sessionState, now)) {
    appendLog(`[thinking-router] skip reason=manual-hold-active session=${sessionKey} until=${sessionState.manualUntil}`);
    return { ok: true, skipped: true, reason: 'manual-hold-active', manualUntil: sessionState.manualUntil };
  }

  const classified = classifyThinkingLevel(text);
  const diagnosticSticky = shouldEnableDiagnosticSticky(text, classified) || isDiagnosticStickyActive(sessionState, now);
  const contextCarry = shouldCarryContextFollowup({ sessionState, text, classified, now, assistantContext });

  const targetLevel = contextCarry.carry
    ? (contextCarry.level || sessionState.contextAnchorLevel || sessionState.lastAppliedLevel || classified.level)
    : classified.level;

  let engineRoute = classifyEngineRoute(text, {
    ...classified,
    level: targetLevel,
  }, {
    sessionState,
    assistantContext,
    diagnosticSticky,
    hasAnchor: Boolean(sessionState?.contextAnchorLevel || sessionState?.lastAppliedLevel),
  });

  if (contextCarry.carry) {
    engineRoute = {
      engineHint: contextCarry.engineHint || sessionState.contextAnchorEngineHint || sessionState.lastEngineHint || engineHintFromLevel(targetLevel),
      reasons: [...(engineRoute.reasons || []), contextCarry.reason],
    };
  }

  const decision = shouldPatchLevel({ sessionState, targetLevel, now });
  const explicitModelPrefix = hasExplicitEnginePrefix(text);

  // When user explicitly requests high-intensity thinking, always force c-main model as well.
  // This ensures "高强度思考" patches both thinkingLevel and model, even if state is stale/invalid.
  let modelDecision = shouldPatchModel({ sessionState, engineHint: engineRoute.engineHint, now, explicitModelPrefix });

  // Fix 4: when soft-model-decay stepped down the engine hint, sync engineRoute.engineHint
  // so the logged/returned engineHint matches the actual model that will be patched.
  if (modelDecision.action === 'patch' && modelDecision.why === 'soft-model-decay') {
    // Find the engineHint that maps to the decayed model
    const decayedModel = modelDecision.model;
    const matchedHint = Object.entries(CONFIG.engineModelByHint).find(([, m]) => m === decayedModel)?.[0];
    if (matchedHint) {
      engineRoute = { ...engineRoute, engineHint: matchedHint, reasons: [...(engineRoute.reasons || []), 'soft-model-decay-hint-sync'] };
    }
  }

  if (classified.explicitLevel === 'high') {
    // Do not override model if user explicitly locked it via /model (direct model hold with no engineHint).
    const directModelHoldActive = isModelHoldActive(sessionState, now) && sessionState?.modelFloorModel && !sessionState?.modelFloorEngineHint;
    if (!directModelHoldActive) {
      const forcedSelection = resolveConfiguredModelSelection(CONFIG.tiers.c, sessionState);
      const forcedModel = forcedSelection.model;
      const currentModel = sessionState?.lastModelOverride ?? null;
      if (forcedModel && currentModel !== forcedModel) {
        modelDecision = { action: 'patch', why: 'explicit-high-force-model', model: forcedModel, poolId: forcedSelection.poolId || null, engineHint: CONFIG.tiers.c };
      }
    }
  }

  const shouldPersistPoolSelection = Boolean(
    !dryRun
    && modelDecision.poolId
    && getStickyModelPoolId(sessionState) !== modelDecision.poolId
  );

  if (decision.action !== 'patch' && modelDecision.action !== 'patch' && !shouldPersistPoolSelection) {
    return {
      ok: true,
      skipped: true,
      reason: `${decision.why}+${modelDecision.why}`,
      targetLevel,
      classifyReasons: classified.reasons,
      contextCarry,
      assistantRequestKind: assistantContext?.requestKind || null,
      diagnosticSticky,
      intent: classified.intent,
      riskDomains: classified.riskDomains,
      complexityScore: classified.complexityScore,
      engineHint: engineRoute.engineHint,
      engineReasons: engineRoute.reasons,
      model: modelDecision.model,
      modelPoolId: modelDecision.poolId || null,
    };
  }

  if (!dryRun) {
    const prePatchSkipReason = getRoutingSkipReason({ sessionKey, channel, sender, text });
    if (prePatchSkipReason) {
      appendLog(`[thinking-router] pre-patch-skip reason=${prePatchSkipReason} session=${sessionKey} sender=${sender || 'unknown'} channel=${channel || 'unknown'} blocked=thinking,model`);
      return {
        ok: true,
        skipped: true,
        reason: prePatchSkipReason,
        targetLevel,
        classifyReasons: classified.reasons,
        contextCarry,
        assistantRequestKind: assistantContext?.requestKind || null,
        diagnosticSticky,
        intent: classified.intent,
        riskDomains: classified.riskDomains,
        complexityScore: classified.complexityScore,
        engineHint: engineRoute.engineHint,
        engineReasons: engineRoute.reasons,
        model: modelDecision.model,
        modelPoolId: modelDecision.poolId || null,
      };
    }

    const patch = {
      ...(decision.action === 'patch' ? { thinkingLevel: decision.level } : {}),
      ...(modelDecision.action === 'patch' ? { model: modelDecision.model } : {}),
    };
    updateSessionState({
      state,
      sessionKey,
      sessionState,
      patchLevel: decision.action === 'patch' ? decision.level : sessionState.lastAppliedLevel,
      touchLevelState: decision.action === 'patch',
      resolvedModel: modelDecision.action === 'patch' ? modelDecision.model : sessionState.lastModelOverride,
      touchModelState: modelDecision.action === 'patch',
      modelPoolId: modelDecision.poolId || null,
      modelEngineHint: modelDecision.engineHint || engineRoute.engineHint,
      engineHint: engineRoute.engineHint,
      now,
      reasons: classified.reasons,
      contextCarry,
      diagnosticSticky,
      assistantContext,
      setModelHold: classified.explicitLevel === 'high',
      modelFloorEngineHint: CONFIG.modelFloor.explicitHighHoldTier,
    });

    if (Object.keys(patch).length === 0) {
      saveState(state);
      appendLog(`[thinking-router] state-only-update session=${sessionKey} sender=${sender || 'unknown'} channel=${channel || 'unknown'} engine=${engineRoute.engineHint} modelPool=${modelDecision.poolId || 'none'} reason=pool-selection-persist`);
      return {
        ok: true,
        skipped: true,
        reason: `${decision.why}+${modelDecision.why}+pool-selection-persisted`,
        targetLevel,
        classifyReasons: classified.reasons,
        contextCarry,
        assistantRequestKind: assistantContext?.requestKind || null,
        diagnosticSticky,
        intent: classified.intent,
        riskDomains: classified.riskDomains,
        complexityScore: classified.complexityScore,
        engineHint: engineRoute.engineHint,
        engineReasons: engineRoute.reasons,
        model: modelDecision.model,
        modelPoolId: modelDecision.poolId || null,
      };
    }

    if (!dryRun) {
      recordDesiredPatch({ state, sessionKey, patch, now });
      saveState(state);
    }
    const queued = dryRun ? { queued: false, pid: null } : queuePatchSession({ sessionKey, patch });
    appendLog(`[thinking-router] queued-patch session=${sessionKey} sender=${sender || 'unknown'} channel=${channel || 'unknown'} level=${decision.level} why=${decision.why} intent=${classified.intent || 'unknown'} risks=${(classified.riskDomains || []).join(',') || 'none'} reasons=${classified.reasons.join(',')} engine=${engineRoute.engineHint} engineReasons=${engineRoute.reasons.join(',')} model=${JSON.stringify(patch.model)} modelPool=${modelDecision.poolId || 'none'} patchHash=${hashPatch(patch)} assistantRequest=${assistantContext?.requestKind || 'none'} diagnosticSticky=${diagnosticSticky ? 'yes' : 'no'} pid=${queued.pid || 'dry-run'}`);
    return {
      ok: true,
      patched: true,
      queued: true,
      level: decision.action === 'patch' ? decision.level : targetLevel,
      reason: `${decision.why}+${modelDecision.why}`,
      classifyReasons: classified.reasons,
      contextCarry,
      assistantRequestKind: assistantContext?.requestKind || null,
      diagnosticSticky,
      intent: classified.intent,
      riskDomains: classified.riskDomains,
      complexityScore: classified.complexityScore,
      engineHint: engineRoute.engineHint,
      engineReasons: engineRoute.reasons,
      model: Object.prototype.hasOwnProperty.call(patch, 'model') ? patch.model : modelDecision.model,
      modelPoolId: modelDecision.poolId || null,
      pid: queued.pid,
    };
  }

  return {
    ok: true,
    patched: false,
    dryRun: true,
    level: decision.action === 'patch' ? decision.level : targetLevel,
    reason: `${decision.why}+${modelDecision.why}`,
    classifyReasons: classified.reasons,
    contextCarry,
    assistantRequestKind: assistantContext?.requestKind || null,
    diagnosticSticky,
    intent: classified.intent,
    riskDomains: classified.riskDomains,
    complexityScore: classified.complexityScore,
    engineHint: engineRoute.engineHint,
    engineReasons: engineRoute.reasons,
    model: modelDecision.model,
    modelPoolId: modelDecision.poolId || null,
  };
}

async function handleHookEvent(event, options = {}) {
  const isReceived = event?.type === 'message' && event?.action === 'received';
  const isPreprocessed = event?.type === 'message' && event?.action === 'preprocessed';

  // For message:preprocessed, content is in bodyForAgent (or body); no `from` field — derive from sessionKey
  let senderId = event?.context?.from;
  let text = event?.context?.content;
  if (isPreprocessed) {
    text = event?.context?.bodyForAgent || event?.context?.body || event?.context?.content;
    if (!senderId) {
      // Extract sender embedded in session key: agent:main:slack:direct:<userId>:thread:...
      const sessionKey = String(event?.sessionKey || '');
      const directMatch = sessionKey.match(/:direct:([^:]+)(?::|$)/);
      if (directMatch) senderId = directMatch[1]; // e.g. "u0ah304q7fw" → normalizeSender uppercases it
    }
  }

  appendLog(`[thinking-router] event type=${event?.type || 'unknown'} action=${event?.action || 'unknown'} session=${event?.sessionKey || 'none'} channel=${event?.context?.channelId || 'unknown'} from=${senderId || 'unknown'} content=${JSON.stringify(normalizeText(text || '')).slice(0, 240)}`);

  if (!event || (!isReceived && !isPreprocessed)) {
    return { ok: true, skipped: true, reason: 'unsupported-event' };
  }

  // message:received is the primary path (earliest hook point).
  // message:preprocessed kept as fallback only — should not normally fire since we switched to received.

  const result = routeThinking(
    {
      sessionKey: event.sessionKey,
      channel: event.context?.channelId,
      senderId,
      text,
    },
    options,
  );

  // If a patch was queued (detached worker), also apply inline immediately so this turn benefits.
  // The detached worker still runs afterward as a reconciler for /status visibility.
  if (result?.patched && result?.queued && !options?.dryRun) {
    const patch = {};
    if (result.level) patch.thinkingLevel = result.level;
    if (result.model !== undefined) patch.model = result.model;
    if (Object.keys(patch).length > 0) {
      try {
        await inlinePatchSessionAsync({ sessionKey: event.sessionKey, patch });
      } catch (err) {
        appendLog(`[thinking-router] inline-patch-error session=${event.sessionKey} err=${String(err?.message || err).slice(0, 200)}`);
      }
    }
  }

  return result;
}

function parseArgValue(argv, name, fallback = '') {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] ?? fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}


function finalizePatchResult({ sessionKey, workerPatchHash, patch, now, clearPending }) {
  const state = loadState();
  const sessionState = state.sessions?.[sessionKey] || {};
  const next = {
    ...sessionState,
    updatedAt: now,
    lastAppliedPatchHash: workerPatchHash,
    lastAppliedPatch: patch,
    lastPatchedAt: now,
  };

  if (clearPending && sessionState.pendingPatchHash === workerPatchHash) {
    next.pendingPatchHash = '';
    delete next.pendingPatch;
  }

  state.sessions[sessionKey] = next;
  saveState(state);
}

function applyPatchWorker({ sessionKey, patch }) {
  const workerPatchHash = hashPatch(patch);
  const lockDir = acquirePatchLock(sessionKey);
  try {
    const state = loadState();
    const sessionState = state.sessions?.[sessionKey] || {};
    const pendingPatchHash = String(sessionState.pendingPatchHash || '');
    const lastAppliedPatchHash = String(sessionState.lastAppliedPatchHash || '');

    if (pendingPatchHash && pendingPatchHash !== workerPatchHash) {
      appendLog(`[thinking-router] patch-worker-stale-skip session=${sessionKey} workerHash=${workerPatchHash} pendingHash=${pendingPatchHash}`);
      return { ok: true, skipped: true, reason: 'stale-patch-hash', sessionKey, patch };
    }

    if (!pendingPatchHash && lastAppliedPatchHash === workerPatchHash) {
      appendLog(`[thinking-router] patch-worker-duplicate-skip session=${sessionKey} workerHash=${workerPatchHash}`);
      return { ok: true, skipped: true, reason: 'already-applied', sessionKey, patch };
    }

    const patched = patchSessionWithRetry({ sessionKey, patch });
    if (!patched.ok) {
      return patched;
    }

    finalizePatchResult({
      sessionKey,
      workerPatchHash,
      patch,
      now: Date.now(),
      clearPending: true,
    });

    return {
      ok: true,
      patched: true,
      sessionKey,
      patch,
      attemptsUsed: patched.attemptsUsed,
      output: patched.output,
      workerPatchHash,
    };
  } finally {
    releasePatchLock(lockDir);
  }
}

function main(argv) {
  const dryRun = hasFlag(argv, '--dry-run');
  const json = hasFlag(argv, '--json');
  const mode = parseArgValue(argv, '--mode', 'route');

  let result;
  if (mode === 'apply-patch') {
    const sessionKey = parseArgValue(argv, '--session-key', '');
    const patchJson = parseArgValue(argv, '--patch-json', '{}');
    const patch = JSON.parse(patchJson);
    const patched = applyPatchWorker({ sessionKey, patch });
    if (patched.ok && patched.skipped) {
      result = patched;
    } else if (patched.ok) {
      appendLog(`[thinking-router] patch-worker-success session=${sessionKey} attempts=${patched.attemptsUsed} patch=${JSON.stringify(patch)} patchHash=${patched.workerPatchHash}`);
      result = { ok: true, patched: true, sessionKey, patch, attempts: patched.attemptsUsed, output: patched.output, patchHash: patched.workerPatchHash };
    } else {
      const error = patched.error;
      appendLog(`[thinking-router] patch-worker-error session=${sessionKey} attempts=${patched.attemptsUsed} patch=${JSON.stringify(patch)} error=${JSON.stringify(String(error?.stack || error))}`);
      appendAlertLog(`[thinking-router] PATCH_WORKER_EXHAUSTED session=${sessionKey} attempts=${patched.attemptsUsed} patch=${JSON.stringify(patch)} error=${JSON.stringify(String(error?.stack || error)).slice(0, 400)}`);
      result = { ok: false, sessionKey, patch, attempts: patched.attemptsUsed, error: String(error?.stack || error) };
      process.exitCode = 1;
    }
  } else if (mode === 'hook') {
    result = handleHookEvent({
      type: 'message',
      action: 'received',
      sessionKey: parseArgValue(argv, '--session-key', ''),
      context: {
        channelId: parseArgValue(argv, '--channel', ''),
        from: parseArgValue(argv, '--sender', ''),
        content: parseArgValue(argv, '--text', ''),
      },
    }, { dryRun });
  } else {
    result = routeThinking({
      sessionKey: parseArgValue(argv, '--session-key', ''),
      channel: parseArgValue(argv, '--channel', ''),
      senderId: parseArgValue(argv, '--sender', ''),
      text: parseArgValue(argv, '--text', ''),
    }, { dryRun });
  }

  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(result);
}

module.exports = {
  CONFIG,
  classifyThinkingLevel,
  routeThinking,
  handleHookEvent,
};

if (require.main === module) {
  main(process.argv.slice(2));
}
