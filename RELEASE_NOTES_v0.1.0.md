# thinking-router v0.1.0

First public open-source release of `thinking-router` for OpenClaw.

## Highlights

- Config-driven routing heuristics (`router.config.json`)
- Weighted per-thread model pools
- Daily cron-based heuristics optimization flow
- `ROUTING_SEMANTICS.md` to define A0 / A1 / A / B / C behavior explicitly
- `cron/heuristics-updater.js` for safe config-only overrides
- `install.sh` for hook install and optional cron deployment
- Minimal CI + regression suite included

## Included in this release

- `thinking-router.js`
- `router.config.example.json`
- `ROUTING_SEMANTICS.md`
- `install.sh`
- `hooks/thinking-router/`
- `cron/daily-router-review.example.json`
- `cron/heuristics-updater.js`
- `cron/heuristics.overrides.example.json`
- `thinking-router-regression.js`
- `.github/workflows/ci.yml`
- `RELEASE_CHECKLIST.md`

## Notes

- `router.config.json` is intentionally not committed; copy from `router.config.example.json`.
- Cron deployment requires an explicit Slack delivery target via `--slack-user-id` or `THINKING_ROUTER_SLACK_USER_ID`.
- Automated optimization is restricted to heuristics/config updates and should not modify `thinking-router.js`.

## Suggested repo description

OpenClaw thinking router with config-driven heuristics, weighted model pools, and cron-based self-optimization.
