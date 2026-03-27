#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = process.argv[2] || path.join(process.cwd(), 'router.config.json');
const OVERRIDES_PATH = process.argv[3] || path.join(process.cwd(), 'heuristics.overrides.json');

function merge(left, right) {
  if (!right) return left;
  const clone = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (Array.isArray(value)) {
      clone[key] = value;
    } else if (value && typeof value === 'object') {
      clone[key] = merge(clone[key] || {}, value);
    } else {
      clone[key] = value;
    }
  }
  return clone;
}

if (!fs.existsSync(CONFIG_PATH)) {
  console.error('[heuristics-updater] router config not found:', CONFIG_PATH);
  process.exit(1);
}
if (!fs.existsSync(OVERRIDES_PATH)) {
  console.error('[heuristics-updater] overrides file missing:', OVERRIDES_PATH);
  process.exit(1);
}

const configRaw = fs.readFileSync(CONFIG_PATH, 'utf8');
const overridesRaw = fs.readFileSync(OVERRIDES_PATH, 'utf8');
let config;
let overrides;
try {
  config = JSON.parse(configRaw);
} catch (err) {
  console.error('[heuristics-updater] failed to parse router.config.json:', err.message);
  process.exit(1);
}
try {
  overrides = JSON.parse(overridesRaw);
} catch (err) {
  console.error('[heuristics-updater] failed to parse overrides:', err.message);
  process.exit(1);
}

const updated = { ...config, heuristics: merge(config.heuristics || {}, overrides) };
const tempPath = `${CONFIG_PATH}.tmp`;
fs.writeFileSync(tempPath, JSON.stringify(updated, null, 2) + '\n');
fs.renameSync(tempPath, CONFIG_PATH);
console.log('[heuristics-updater] applied overrides and rewrote', CONFIG_PATH);
