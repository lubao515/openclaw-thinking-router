# thinking-router

An [OpenClaw](https://openclaw.ai) plugin that automatically routes AI model selection and thinking intensity based on conversation intent and risk level.

## What it does

Instead of using a single model for every message, thinking-router classifies each incoming message and applies the appropriate model + thinking tier:

| Tier | Use case | Example |
|------|----------|---------|
| A0 | Translation / rewrite / very short Q&A | "translate this to English" |
| A1 | Standalone summary / draft / low-risk recommendation | "write a short summary" |
| A  | Context-heavy follow-ups | short replies in an ongoing thread |
| B  | Analysis / debug / design / normal execution | "why is this failing?" |
| C  | Risk domain + execute / deploy / delete | "restart the service", trading actions |

It also supports **model pools** — per-thread weighted random selection between different model lineups (e.g. Claude-primary vs GPT-primary), so you can balance quota across providers.

## Prerequisites

- [OpenClaw](https://openclaw.ai) installed and running
- Slack bot configured in OpenClaw
- Node.js 18+

## Setup

```bash
# 1. Clone
git clone https://github.com/lubao515/thinking-router.git
cd thinking-router

# 2. Create your config (gitignored)
cp router.config.example.json router.config.json

# 3. Edit router.config.json
#    - Set allowedSenders to your Slack User ID(s)
#    - Adjust model pools to your preferred models
```

## Install modes

### 1) Hook/router only

```bash
bash install.sh
```

This copies the router, hook handler, config example, routing semantics, cron helper scripts, and cron template into your OpenClaw workspace (default `${HOME}/.openclaw/workspace`, override with `--workspace PATH` or `OPENCLAW_WORKSPACE_DIR`). It then enables the hook and restarts the gateway.

### 2) Hook/router + cron deployment

```bash
bash install.sh --deploy-cron --slack-user-id YOUR_SLACK_USER_ID
```

Use this when you want the daily optimization job registered automatically.

`install.sh` will:
- copy the same router/hook/config files as above
- render `$WORKSPACE/cron/daily-router-review.json`
- replace these placeholders with real values:
  - `YOUR_SLACK_USER_ID`
  - `<THINKING_ROUTER_SCRIPT_PATH>`
  - `<ROUTER_LOG_PATH>`
  - `<ROUTER_CONFIG_PATH>`
  - `<ROUTING_SEMANTICS_PATH>`
- call `openclaw cron add` using CLI arguments derived from the rendered JSON

Slack delivery target must be provided explicitly via one of:
- `--slack-user-id YOUR_SLACK_USER_ID`
- `THINKING_ROUTER_SLACK_USER_ID=...`
- interactive prompt (TTY only)

The script does **not** infer your Slack ID from `router.config.json`.

If deployment fails, the rendered cron file stays in place for manual inspection and re-run.

## Configuration

All configuration lives in `router.config.json` (gitignored — copy from `router.config.example.json`).

### Key fields

| Field | Description |
|-------|-------------|
| `allowedSenders` | Slack User IDs that the router will process. Config value takes precedence; if left empty you can still populate `ROUTER_ALLOWED_SENDERS` as an environment variable. |
| `enabledChannels` | Array of channel identifiers. The router currently implements only Slack, but this field can extend to future channels without touching the core logic. |
| `modelPools` | Array of model lineups with weights. Higher weight → selected more often. Each pool defines tier → model bindings (`a0-main`, `a1-main`, `b-main`, etc.). |
| `timing` | Controls sticky durations, dedupe windows, context carry, and hold times. The values are merged with safe defaults when omitted. |
| `patchRetry` | Retry policy for `session.patch` operations (attempts, delays, jitter). Keep defaults unless you are experimenting with reliability tuning. |
| `assistantContextScanMessages` | The number of past messages scanned when scoring context-level risk heuristics. |
| `keepStateDays` / `keepMaxSessions` | Controls how long router state is retained in `state/thinking-router-state.json`.

### Router config JSON

The router script lives at `$WORKSPACE/scripts/thinking-router.js` and looks for `router.config.json` one directory up — i.e. at `$WORKSPACE/router.config.json` (override the path with `ROUTER_CONFIG_PATH`). If the file is absent, it falls back to built-in defaults, so the router still runs without extra setup. The best practice is to:

1. `cp router.config.example.json router.config.json`
2. Fill real `allowedSenders`, tweak `timing`, and adjust `modelPools` to match your quota mix.
3. Keep `router.config.json` out of Git (`.gitignore` is already configured).

You can still override `allowedSenders` via `ROUTER_ALLOWED_SENDERS` (comma-separated, Trimmed) for deployments that prefer env-based secrets.

### Finding your Slack User ID

In Slack: click your profile → "Copy member ID".

### Model pool design

Pools let you A/B between different model lineups at the thread level. A pool is selected once when a thread starts and stays consistent for that thread.

```json
{
  "id": "pool-1",
  "weight": 5,
  "tiers": {
    "a0-main": "google/gemini-3.1-flash-lite-preview",
    "b-main": "anthropic/claude-sonnet-4-6",
    "c-main": "anthropic/claude-sonnet-4-6"
  }
}
```

Weight example: pool-1 weight=5, pool-2 weight=1 → pool-1 selected ~83% of the time.

## Heuristics structure

The `heuristics` block in `router.config.json` controls every regex used for routing, mutation detection, short questions, explicit levels, and prefix overrides. The default block (see `router.config.example.json`) already mirrors the production intent, but you can tweak any field via overrides. Tier semantics themselves live in `ROUTING_SEMANTICS.md`, which the cron optimizer should read before touching heuristics.

- `configMutation`, `intent`, `risk`, `complexity`, `question`, and `contextHeavyFollowup` keep their existing semantics.
- `explicitLevel` lets cron reroute certain phrases into `high`/`medium`/`low`.
- `explicitPrefixToEngineHint` maps `/a`, `/g`, `review:` etc. to specific engine hints so cron can evolve the alias set without modifying `thinking-router.js`.

When updating heuristics, write overrides into `cron/heuristics.overrides.json` (or another file) and run `node cron/heuristics-updater.js router.config.json cron/heuristics.overrides.json`. That helper merges overrides safely (it writes a `.tmp` file first). The cron job reads/writes `router.config.json` directly and never depends on README contents.

## Cron job: daily router review

A cron job keeps the router healthy by scanning logs and applying high-confidence heuristics tweaks.

### Manual registration

1. Copy the template into your workspace or cron directory.
2. Replace placeholders (`YOUR_JOB_ID`, `YOUR_SLACK_USER_ID`, `<THINKING_ROUTER_SCRIPT_PATH>`, `<ROUTER_LOG_PATH>`, `<ROUTER_CONFIG_PATH>`, `<ROUTING_SEMANTICS_PATH>`).
3. Register the job with `openclaw cron add ...` using values from the rendered JSON.
4. After heuristics change, run `openclaw gateway restart` so the new rules take effect.

### Auto registration via install.sh

`install.sh --deploy-cron --slack-user-id ...` renders `$WORKSPACE/cron/daily-router-review.json` and then calls `openclaw cron add` with CLI arguments derived from the rendered JSON. If deployment fails, the rendered file stays behind for manual review and retry.

### Automation contract

The cron job should:
- read `router.config.json`, `ROUTING_SEMANTICS.md`, the router log, and the router script (read-only)
- update only heuristics/config, never `thinking-router.js`
- use `cron/heuristics-updater.js` (or equivalent JSON-safe merge logic) to apply overrides
- output `NO_REPLY` only when there is no change and no human review is needed
- output a brief Chinese summary when it made a change, or a brief Chinese suggestion when human review is needed

README is for humans. Automation should read the actual files (`router.config.json`, `ROUTING_SEMANTICS.md`, rendered cron JSON), not depend on README text at runtime.
## How routing works

1. Message arrives via Slack
2. Router checks `allowedSenders` — non-matching senders pass through to OpenClaw default
3. Text is classified across multiple axes: intent, risk domain, complexity, explicit override prefixes
4. A thinking tier (A0/A1/A/B/C) is selected (first-match rule set)
5. The thread's model pool is looked up (or assigned on first message)
6. `session.patch` is called to switch the active model + thinking level

## Known limitations

- Slack only (no Discord, Telegram, etc. yet)
- Requires OpenClaw's internal `session.patch` API — not compatible with other runtimes
- Session key format is OpenClaw-specific

## Release hygiene

- Minimal CI lives in `.github/workflows/ci.yml`
- Release steps live in `RELEASE_CHECKLIST.md`

## License

MIT
