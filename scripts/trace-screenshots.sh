#!/usr/bin/env bash
# Console screenshots of each step's X-Ray / CloudWatch trace:
#   NN-trace-map.png       trace graph in full screen (client, coordinator, specialists)
#   NN-trace-timeline.png  span timeline waterfall of the whole trace (tall viewport)
# Requires an agent-browser session that is already signed in to the AWS console (never put a sign-in URL here).
# Usage: scripts/trace-screenshots.sh [step-dir-name ...]   (default: 07-xray 08-otel 10-mode 11-all)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMG="$ROOT/report/img"
REGION="${AWS_REGION:-eu-central-1}"
mkdir -p "$IMG"
# click a button by its accessible name, retrying while the console renders
click_button() {
  local ref
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    ref="$(agent-browser snapshot -i -c 2>&1 | grep -E "button \"$1\"" | grep -oE 'ref=e[0-9]+' | head -1 | cut -d= -f2 || true)"
    if [ -n "$ref" ] && agent-browser click "@$ref" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "   WARN: button '$1' not found"; return 1
}

if [ "$#" -gt 0 ]; then steps=("$@"); else steps=(07-xray 08-otel 10-mode 11-all); fi

for s in "${steps[@]}"; do
  num="${s%%-*}"
  trace="$(grep -oE '1-[0-9a-f]{8}-[0-9a-f]{24}' "$ROOT/src/steps/$s/artifacts/trace-ids.txt" | head -1)"
  echo "== $s  trace $trace"
  agent-browser set viewport 1600 2100 >/dev/null
  # a hash-only change keeps the previously loaded trace in the SPA, so go through a blank page first
  agent-browser open about:blank >/dev/null; sleep 1
  agent-browser open "https://$REGION.console.aws.amazon.com/cloudwatch/home?region=$REGION#xray:traces/$trace" >/dev/null
  shown=""
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
    shown="$(agent-browser snapshot -i -c 2>&1 | grep -oE 'link "Trace 1-[0-9a-f]{8}-[0-9a-f]{24}' | grep -oE '1-[0-9a-f-]+' | head -1 || true)"
    [ -z "$shown" ] || break; sleep 2
  done
  if [ "$shown" != "$trace" ]; then echo "   ERROR: page shows trace '$shown', expected '$trace'"; exit 1; fi
  sleep 4
  spans=""
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    spans="$(agent-browser snapshot -i -c 2>&1 | grep -oE 'button "Spans: [0-9]+' | grep -oE '[0-9]+' | head -1 || true)"
    [ -z "$spans" ] || break; sleep 2
  done
  echo "   page shows trace $shown, spans=$spans"

  # 1) trace map: the graph in full screen
  click_button "Full screen" || true; sleep 5
  agent-browser screenshot "$IMG/$num-trace-map.png" >/dev/null; echo "   saved $num-trace-map.png"
  agent-browser press Escape >/dev/null 2>&1 || true; sleep 2

  # 2) timeline: whole waterfall in one image (resize first: resizing re-renders the page back to the List view)
  h=$(( 900 + ${spans:-50} * 36 )); [ "$h" -le 9000 ] || h=9000
  agent-browser set viewport 1600 "$h" >/dev/null; sleep 3
  click_button "Timeline" || true; sleep 4
  agent-browser eval '(()=>{window.scrollTo(0,0);document.querySelectorAll("*").forEach(e=>{if(e.scrollTop)e.scrollTop=0});return 1})()' >/dev/null; sleep 1
  agent-browser screenshot "$IMG/$num-trace-timeline.png" >/dev/null; echo "   saved $num-trace-timeline.png (height $h)"
  agent-browser set viewport 1600 1300 >/dev/null
done
