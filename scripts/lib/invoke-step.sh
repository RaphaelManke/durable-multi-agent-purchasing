#!/usr/bin/env bash
# Shared logic for src/steps/NN-name/invoke.sh. Source it after setting:
#   STEP_DIR         absolute path of the step folder (contains request.json)
#   FUNCTION_NAME    deployed function, invoked as <name>:live
#   TIMEOUT_SECONDS  max wait for a terminal durable execution status per try
#   SAVE_REPORT=1    (optional) also save REPORT lines to report.txt
#
# Invokes asynchronously, polls the durable execution to a terminal status
# (3 tries max) and writes artifacts/. Exits non-zero unless SUCCEEDED.

set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-otel-playground}"
export AWS_REGION="${AWS_REGION:-eu-central-1}"
export AWS_DEFAULT_REGION="$AWS_REGION"
export AWS_PAGER=""

MAX_TRIES=3
POLL_SECONDS=3
ART="$STEP_DIR/artifacts"
LOG_GROUP="/aws/lambda/$FUNCTION_NAME"

log() { printf '[%s] %s\n' "$FUNCTION_NAME" "$*" >&2; }

# Prints a console sign-in URL (federation, valid 15 min) that opens the durable
# execution page. Needs temporary CLI credentials (SSO or assumed role). The URL
# is a bearer login, so it only goes to stderr, never into artifacts/.
console_link() {
  local arn=$1 fn ver name id dest session token
  fn=$(cut -d: -f7 <<<"$arn"); ver=$(cut -d: -f8 <<<"$arn" | cut -d/ -f1)
  name=$(cut -d/ -f3 <<<"$arn"); id=$(cut -d/ -f4 <<<"$arn")
  dest="https://$AWS_REGION.console.aws.amazon.com/lambda/home?region=$AWS_REGION#/functions/$fn/versions/$ver/executions/$name/$id"
  session=$(aws configure export-credentials --format process \
    | jq -er 'select(.SessionToken) | {sessionId: .AccessKeyId, sessionKey: .SecretAccessKey, sessionToken: .SessionToken} | tojson | @uri') || return 1
  token=$(curl -fsS "https://signin.aws.amazon.com/federation?Action=getSigninToken&Session=$session" | jq -er .SigninToken) || return 1
  local url="https://signin.aws.amazon.com/federation?Action=login&Destination=$(jq -rn --arg d "$dest" '$d|@uri')&SigninToken=$token"
  # OSC 8 hyperlink on a terminal; the plain URL when stderr is piped or saved.
  if [ -t 2 ]; then
    log "$(printf '\e]8;;%s\e\\%s\e]8;;\e\\' "$url" "open execution $id in AWS console")"
  else
    log "console: $url"
  fi
}

run_once() {
  rm -rf "$ART" && mkdir -p "$ART"
  cp "$STEP_DIR/request.json" "$ART/request.json"

  local start_ms
  start_ms=$(( $(date +%s) * 1000 - 5000 ))

  # --debug prints the response headers (x-amzn-RequestId) on stderr.
  aws lambda invoke \
    --function-name "$FUNCTION_NAME:live" \
    --invocation-type Event \
    --payload "fileb://$ART/request.json" \
    --debug \
    "$ART/invoke-body.json" > "$ART/invoke-output.json" 2> "$ART/invoke-debug.txt"

  local request_id
  request_id=$(grep -ioE "x-amzn-requestid'?: *'[0-9a-f-]{36}" "$ART/invoke-debug.txt" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || true)
  [ -n "$request_id" ] || { log "no x-amzn-RequestId found in response headers"; return 1; }
  printf '%s\n' "$request_id" > "$ART/request-id.txt"

  jq -n \
    --slurpfile out "$ART/invoke-output.json" \
    --arg rid "$request_id" \
    --rawfile body "$ART/invoke-body.json" \
    '{StatusCode: $out[0].StatusCode, ExecutedVersion: $out[0].ExecutedVersion,
      DurableExecutionArn: $out[0].DurableExecutionArn,
      Headers: {"x-amzn-RequestId": $rid}, Body: $body}' > "$ART/response.json"
  rm -f "$ART/invoke-body.json" "$ART/invoke-output.json" "$ART/invoke-debug.txt"

  [ "$(jq -r '.StatusCode' "$ART/response.json")" = "202" ] || { log "unexpected StatusCode"; return 1; }

  local arn
  arn=$(jq -r '.DurableExecutionArn // empty' "$ART/response.json")
  if [ -z "$arn" ]; then
    # Fallback: newest execution of this function/alias.
    arn=$(aws lambda list-durable-executions-by-function --function-name "$FUNCTION_NAME" \
      --qualifier live --reverse-order --max-items 1 --query 'DurableExecutions[0].DurableExecutionArn' --output text)
  fi
  [ -n "$arn" ] && [ "$arn" != "None" ] || { log "no durable execution ARN"; return 1; }
  printf '%s\n' "$arn" > "$ART/durable-execution-arn.txt"
  printf '%s\n' "${arn##*/}" > "$ART/durable-execution-id.txt"
  log "execution ${arn##*/} started (request $request_id)"
  console_link "$arn" || log "console link unavailable (needs temporary CLI credentials)"

  local deadline status=""
  deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    status=$(aws lambda get-durable-execution --durable-execution-arn "$arn" --query 'Status' --output text)
    case "$status" in
      SUCCEEDED|FAILED|TIMED_OUT|STOPPED) break ;;
    esac
    sleep "$POLL_SECONDS"
  done
  log "status: ${status:-unknown}"

  aws lambda get-durable-execution --durable-execution-arn "$arn" --output json > "$ART/execution.json"
  aws lambda get-durable-execution-history --durable-execution-arn "$arn" --output json > "$ART/history.json"

  # CloudWatch ingestion lags; wait for the log events of the final invocation.
  local i
  for i in 1 2 3 4 5 6; do
    sleep 5
    aws logs filter-log-events --log-group-name "$LOG_GROUP" --start-time "$start_ms" --output json \
      | jq -r '.events[] | "\(.timestamp) \(.message | rtrimstr("\n"))"' > "$ART/logs.txt"
    if [ "${SAVE_REPORT:-0}" = "1" ]; then
      # Functions log JSON, so the REPORT line arrives as a platform.report record.
      grep -E 'platform\.report' "$ART/logs.txt" \
        | sed -E 's/^[0-9]+ //' \
        | jq -r '.record | "REPORT RequestId: \(.requestId)\tDuration: \(.metrics.durationMs) ms\tBilled Duration: \(.metrics.billedDurationMs) ms\tMemory Size: \(.metrics.memorySizeMB) MB\tMax Memory Used: \(.metrics.maxMemoryUsedMB) MB\tStatus: \(.status // "success")"' > "$ART/report.txt" || true
      # Done once every invocation in the history (InvocationCompleted) has its platform.report.
      [ -s "$ART/report.txt" ] && [ "$(grep -c 'platform\.report' "$ART/logs.txt")" -ge "$(jq '[.Events[] | select(.EventType == "InvocationCompleted")] | length' "$ART/history.json")" ] && break
    else
      [ -s "$ART/logs.txt" ] && grep -q 'END RequestId' "$ART/logs.txt" && break
    fi
  done
  [ -s "$ART/logs.txt" ] || { log "no log events captured"; return 1; }
  if [ "${SAVE_REPORT:-0}" = "1" ]; then
    [ -s "$ART/report.txt" ] || { log "no REPORT line captured"; return 1; }
  fi

  [ "$status" = "SUCCEEDED" ]
}

try=1
while [ "$try" -le "$MAX_TRIES" ]; do
  log "try $try of $MAX_TRIES"
  if run_once; then
    log "SUCCEEDED, artifacts in $ART"
    exit 0
  fi
  try=$(( try + 1 ))
done
log "not SUCCEEDED after $MAX_TRIES tries"
exit 1
