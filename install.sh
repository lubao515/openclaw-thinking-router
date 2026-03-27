#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_NAME="thinking-router"

DEFAULT_WORKSPACE="${HOME}/.openclaw/workspace"
WORKSPACE_ARG=""
SLACK_USER_ID_ARG=""
DEPLOY_CRON=false

usage() {
  echo "Usage: $0 [--workspace PATH] [--slack-user-id U12345678] [--deploy-cron]" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace)
      shift
      if [[ $# -eq 0 ]]; then
        usage
      fi
      WORKSPACE_ARG="$1"
      shift
      ;;
    --workspace=*)
      WORKSPACE_ARG="${1#*=}"
      shift
      ;;
    --slack-user-id)
      shift
      if [[ $# -eq 0 ]]; then
        usage
      fi
      SLACK_USER_ID_ARG="$1"
      shift
      ;;
    --slack-user-id=*)
      SLACK_USER_ID_ARG="${1#*=}"
      shift
      ;;
    --deploy-cron)
      DEPLOY_CRON=true
      shift
      ;;
    *)
      usage
      ;;
  esac
done

WORKSPACE="${WORKSPACE_ARG:-${OPENCLAW_WORKSPACE_DIR:-}}"
if [[ -z "$WORKSPACE" ]]; then
  WORKSPACE="$DEFAULT_WORKSPACE"
  if [[ ! -d "$WORKSPACE" ]]; then
    echo "[thinking-router] 默认 workspace $WORKSPACE 不存在，请传入 --workspace PATH 或创建该目录。" >&2
    exit 1
  fi
fi

if [[ "$WORKSPACE" == ~* ]]; then
  WORKSPACE="${HOME}${WORKSPACE:1}"
fi
WORKSPACE="${WORKSPACE%/}"

if [[ ! -d "$WORKSPACE" ]]; then
  echo "[thinking-router] workspace $WORKSPACE 不存在，请确认路径正确或提前创建。" >&2
  exit 1
fi

export WORKSPACE
STATE_DIR="$WORKSPACE/state"
CRON_DIR="$WORKSPACE/cron"
CRON_EXAMPLE_FILE="$CRON_DIR/daily-router-review.example.json"
CRON_DEPLOY_FILE="$CRON_DIR/daily-router-review.json"
LOG_PATH="$STATE_DIR/thinking-router.log"
TARGET_SCRIPTS_DIR="$WORKSPACE/scripts"
TARGET_HOOK_DIR="$WORKSPACE/hooks/$HOOK_NAME"

mkdir -p "$STATE_DIR"

copy_file() {
  local src="$1"
  local dst="$2"
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  echo "[thinking-router] copied $(basename "$src") -> $dst"
}

copy_file "$SRC_DIR/thinking-router.js" "$TARGET_SCRIPTS_DIR/thinking-router.js"
copy_file "$SRC_DIR/hooks/thinking-router/handler.js" "$TARGET_HOOK_DIR/handler.js"
copy_file "$SRC_DIR/hooks/thinking-router/HOOK.md" "$TARGET_HOOK_DIR/HOOK.md"

if [[ -f "$SRC_DIR/router.config.example.json" ]]; then
  copy_file "$SRC_DIR/router.config.example.json" "$WORKSPACE/router.config.example.json"
fi
if [[ -f "$SRC_DIR/ROUTING_SEMANTICS.md" ]]; then
  copy_file "$SRC_DIR/ROUTING_SEMANTICS.md" "$WORKSPACE/ROUTING_SEMANTICS.md"
fi

if [[ ! -f "$WORKSPACE/router.config.json" ]]; then
  echo "[thinking-router] Note: no router.config.json found at $WORKSPACE/"
  echo "  Run: cp $WORKSPACE/router.config.example.json $WORKSPACE/router.config.json"
  echo "  Then fill in allowedSenders and adjust modelPools."
fi

SLACK_USER_ID="${SLACK_USER_ID_ARG:-${THINKING_ROUTER_SLACK_USER_ID:-}}"
if [[ "$DEPLOY_CRON" == true && -z "$SLACK_USER_ID" ]]; then
  if [[ -t 0 ]]; then
    read -r -p "Enter YOUR_SLACK_USER_ID: " SLACK_USER_ID
  fi
  if [[ -z "$SLACK_USER_ID" ]]; then
    echo "[thinking-router] --deploy-cron requires Slack delivery target." >&2
    echo "  Pass --slack-user-id U12345678 or set THINKING_ROUTER_SLACK_USER_ID." >&2
    exit 1
  fi
fi
export SLACK_USER_ID

if [[ -f "$SRC_DIR/cron/daily-router-review.example.json" ]]; then
  mkdir -p "$CRON_DIR"
  copy_file "$SRC_DIR/cron/daily-router-review.example.json" "$CRON_EXAMPLE_FILE"
  copy_file "$SRC_DIR/cron/heuristics-updater.js" "$CRON_DIR/heuristics-updater.js"
  copy_file "$SRC_DIR/cron/heuristics.overrides.example.json" "$CRON_DIR/heuristics.overrides.example.json"

  export CRON_EXAMPLE_FILE CRON_DEPLOY_FILE TARGET_SCRIPTS_DIR LOG_PATH DEPLOY_CRON

  python3 <<'PY'
import json, os, pathlib, subprocess, sys, uuid

workspace = pathlib.Path(os.environ['WORKSPACE'])
example_path = pathlib.Path(os.environ['CRON_EXAMPLE_FILE'])
deploy_path = pathlib.Path(os.environ['CRON_DEPLOY_FILE'])
script_path = str(pathlib.Path(os.environ['TARGET_SCRIPTS_DIR']) / 'thinking-router.js')
log_path = os.environ['LOG_PATH']
deploy_cron = os.environ.get('DEPLOY_CRON', 'false').lower() == 'true'

slack_id = os.environ.get('SLACK_USER_ID', '').strip() or 'YOUR_SLACK_USER_ID'

job = json.loads(example_path.read_text())
job['id'] = str(uuid.uuid4())
job['delivery']['to'] = slack_id
message = job['payload']['message']
message = message.replace('YOUR_SLACK_USER_ID', slack_id)
message = message.replace('<THINKING_ROUTER_SCRIPT_PATH>', script_path)
message = message.replace('<ROUTER_LOG_PATH>', log_path)
message = message.replace('<ROUTER_CONFIG_PATH>', str(workspace / 'router.config.json'))
message = message.replace('<ROUTING_SEMANTICS_PATH>', str(workspace / 'ROUTING_SEMANTICS.md'))
job['payload']['message'] = message

deploy_path.write_text(json.dumps(job, indent=2, ensure_ascii=False) + '\n')
print(f"[thinking-router] cron job prepared {job['id']} name={job['name']}")

if not deploy_cron:
    raise SystemExit(0)

if (
    ('YOUR_SLACK_USER_ID' in message)
    or ('<THINKING_ROUTER_SCRIPT_PATH>' in message)
    or ('<ROUTER_LOG_PATH>' in message)
    or ('<ROUTER_CONFIG_PATH>' in message)
    or ('<ROUTING_SEMANTICS_PATH>' in message)
):
    print(f"[thinking-router] cron job file {deploy_path} still contains placeholders; edit it before deploying.", file=sys.stderr)
    raise SystemExit(0)

cmd = [
    'openclaw', 'cron', 'add',
    '--name', job['name'],
    '--agent', job.get('agentId', 'main'),
    '--cron', job['schedule']['expr'],
    '--session', job.get('sessionTarget', 'isolated'),
    '--message', job['payload']['message'],
    '--thinking', job['payload'].get('thinking', 'medium'),
]

if job['schedule'].get('tz'):
    cmd.extend(['--tz', job['schedule']['tz']])
if job['payload'].get('model'):
    cmd.extend(['--model', job['payload']['model']])

delivery = job.get('delivery', {})
if delivery.get('mode') == 'announce':
    cmd.append('--announce')
if delivery.get('channel'):
    cmd.extend(['--channel', delivery['channel']])
if delivery.get('to'):
    cmd.extend(['--to', delivery['to']])
if not job.get('enabled', True):
    cmd.append('--disabled')

result = subprocess.run(cmd, text=True, capture_output=True)
if result.returncode == 0:
    print(f"[thinking-router] deployed cron job from {deploy_path}")
    if result.stdout.strip():
        print(result.stdout.strip())
else:
    print('[thinking-router] failed to deploy cron job.', file=sys.stderr)
    if result.stderr.strip():
        print(result.stderr.strip(), file=sys.stderr)
    elif result.stdout.strip():
        print(result.stdout.strip(), file=sys.stderr)
    raise SystemExit(result.returncode)
PY
fi

if [[ -f "$CRON_DEPLOY_FILE" ]] && [[ "$DEPLOY_CRON" == true ]]; then
  echo "[thinking-router] cron install attempted with job file $CRON_DEPLOY_FILE"
fi

echo "[thinking-router] enabling hook: $HOOK_NAME"
openclaw hooks enable "$HOOK_NAME" || true

echo "[thinking-router] reloading gateway"
openclaw gateway restart || true
sleep 3

echo "[thinking-router] current hook status"
openclaw hooks list --verbose | sed -n '1,220p'

cat <<'EOF'
[thinking-router] suggested smoke test:
  1) 在新的 Slack thread 里发: 请高强度思考，帮我分析这个自动化方案
  2) 等 1 秒
  3) 发: /status
EOF
