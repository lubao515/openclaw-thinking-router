# RELEASE_CHECKLIST.md

Use this checklist before publishing a GitHub release.

## 1. Sanity checks

- [ ] `bash -n install.sh`
- [ ] `python3 - <<'PY' ... json.load(open('cron/daily-router-review.example.json')); json.load(open('router.config.example.json')) ... PY`
- [ ] `node -e "require('./thinking-router.js'); console.log('LOAD_OK')"`
- [ ] `ROUTER_ALLOWED_SENDERS=TEST_USER node thinking-router-regression.js`

## 2. Repo hygiene

- [ ] `router.config.json` is **not** committed
- [ ] no personal Slack IDs are committed outside examples/placeholders
- [ ] no local absolute paths remain in docs except deliberate examples/placeholders
- [ ] README matches the current install/deploy flow

## 3. Install flow

- [ ] `bash install.sh`
- [ ] verify router files land in:
  - `$WORKSPACE/scripts/thinking-router.js`
  - `$WORKSPACE/hooks/thinking-router/handler.js`
  - `$WORKSPACE/router.config.example.json`
  - `$WORKSPACE/ROUTING_SEMANTICS.md`
  - `$WORKSPACE/cron/heuristics-updater.js`
  - `$WORKSPACE/cron/heuristics.overrides.example.json`

## 4. Optional cron flow

- [ ] `bash install.sh --deploy-cron --slack-user-id YOUR_SLACK_USER_ID`
- [ ] verify rendered file exists: `$WORKSPACE/cron/daily-router-review.json`
- [ ] verify `openclaw cron list` shows `daily-router-review`
- [ ] verify the prompt references:
  - router log path
  - router config path
  - routing semantics path
  - read-only router script path

## 5. Smoke test in OpenClaw

- [ ] start a fresh Slack thread
- [ ] send a translation-style prompt → expect A0 route
- [ ] send a recommendation-style prompt → expect A1 route
- [ ] send a debug/config explain prompt → expect B route
- [ ] send a risky state-changing prompt → expect C route
- [ ] if model pools are enabled, verify pool stickiness inside one thread

## 6. Release artifacts

- [ ] tag/release notes mention config-driven heuristics
- [ ] release notes mention `ROUTING_SEMANTICS.md`
- [ ] release notes mention `--slack-user-id` for cron deployment
