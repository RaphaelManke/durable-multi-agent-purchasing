#!/usr/bin/env bash
# Capture the Lambda console "durable execution" detail page for each step:
# operations tree fully expanded, every event expanded (all pages), Input/Output and Logger output tabs.
# Requires an agent-browser session that is already signed in to the AWS console (never put a sign-in URL here).
# Usage: scripts/exec-screenshots.sh [step-dir-name ...]   (default: all steps that have an execution ARN)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMG="$ROOT/report/img"
REGION="${AWS_REGION:-eu-central-1}"
mkdir -p "$IMG"

expand_ops='(()=>{const bs=[...document.querySelectorAll("button")].filter(b=>{if(b.getAttribute("aria-expanded")!=="false"||!/^Expand/i.test(b.getAttribute("aria-label")||b.innerText))return false;const tr=b.closest("tr");if(!tr)return false;const first=(tr.innerText||"").trim().split(/\s+/)[0];return !/^\d+$/.test(first)});bs.forEach(b=>b.click());return bs.length})()'
expand_events='(()=>{const ts=document.querySelectorAll("table");const t=ts[ts.length-1];const bs=[...t.querySelectorAll("button")].filter(b=>b.getAttribute("aria-expanded")==="false"&&/^Expand/i.test(b.getAttribute("aria-label")||b.innerText));bs.forEach(b=>b.click());return bs.length})()'
ops_total='(()=>{const h=[...document.querySelectorAll("h2")].find(x=>/^Durable operations/.test(x.innerText));const m=h&&h.innerText.match(/\((\d+)\)/);return m?+m[1]:0})()'
ops_rows='(()=>[...document.querySelectorAll("tr")].filter(r=>{const t=(r.innerText||"").trim();return !/^\d+$/.test(t.split(/\s+/)[0])&&/(Succeeded|Failed|Running|Pending|Cancelled|Stopped|Timed out)/.test(t)&&!/Event ID/.test(t)}).length)()'
next_page='(()=>{const bs=[...document.querySelectorAll("button")].filter(b=>b.getAttribute("aria-label")==="Next page");const b=bs[bs.length-1];if(b&&!b.disabled&&b.getAttribute("aria-disabled")!=="true"){b.click();return 1}return 0})()'
event_count='(()=>{const h=[...document.querySelectorAll("h2")].find(x=>/^Event history/.test(x.innerText));const m=h&&h.innerText.match(/\((\d+)\)/);return m?+m[1]:0})()'
unpin='(()=>{let n=0;document.querySelectorAll("*").forEach(e=>{const p=getComputedStyle(e).position;if((p==="fixed"||p==="sticky")&&!e.closest("[role=dialog]")){e.style.position="static";n++}});return n})()'
first_page='(()=>{const bs=[...document.querySelectorAll("button")].filter(b=>/^Page 1 of/.test(b.getAttribute("aria-label")||""));const b=bs[bs.length-1];if(b){b.click();return 1}return 0})()'

# setpref <table index: 0 = operations, last = events> <radio label prefix>
setpref() {
  agent-browser eval "(()=>{const bs=[...document.querySelectorAll('button')].filter(b=>/^Preferences\$/.test(b.getAttribute('aria-label')||b.innerText));bs[$1<0?bs.length+$1:$1].click();return bs.length})()" >/dev/null; sleep 2
  local snap r c; snap="$(agent-browser snapshot -c 2>&1)"
  r="$(echo "$snap" | grep -E "radio \"$2" | grep -oE 'ref=e[0-9]+' | head -1 | cut -d= -f2)"; c="$(echo "$snap" | grep -E 'button "Confirm' | grep -oE 'ref=e[0-9]+' | head -1 | cut -d= -f2)"
  if [ -n "$r" ] && [ -n "$c" ]; then agent-browser click "@$r" >/dev/null; agent-browser click "@$c" >/dev/null; sleep 3; else echo "   WARN: could not set page size '$2'"; fi
}

if [ "$#" -gt 0 ]; then steps=("$@"); else steps=($(cd "$ROOT/src/steps" && ls -d */ | tr -d / | while read -r s; do { [ -s "$s/artifacts/durable-execution-arn.txt" ] && echo "$s" || true; }; done)); fi

for s in "${steps[@]}"; do
  num="${s%%-*}"
  arn="$(tr -d '[:space:]' < "$ROOT/src/steps/$s/artifacts/durable-execution-arn.txt")"
  fn="$(echo "$arn" | cut -d: -f7)"; ver="$(echo "$arn" | cut -d: -f8 | cut -d/ -f1)"
  name="$(echo "$arn" | cut -d/ -f3)"; id="$(echo "$arn" | cut -d/ -f4)"
  echo "== $s  $fn:$ver  $id"
  agent-browser open "https://$REGION.console.aws.amazon.com/lambda/home?region=$REGION#/functions/$fn/versions/$ver/executions/$name/$id" >/dev/null
  sleep 7
  clicktab() { agent-browser eval "(()=>{const t=[...document.querySelectorAll('[role=tab]')].find(x=>x.innerText.trim()==='$1');if(t)t.click();return !!t})()" >/dev/null; }
  for tab in "Input/Output:io"; do
    label="${tab%%:*}"; slug="${tab##*:}"
    clicktab "$label"; sleep 3
    agent-browser screenshot "$IMG/$num-exec-$slug.png" >/dev/null
    echo "   saved $num-exec-$slug.png"
  done
  clicktab "Details"; sleep 2
  setpref 0 "50 operations"                       # operations table: show the whole tree
  # expand until the visible row count equals the "Durable operations (N)" heading (nested levels render only after the parent expands)
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
    want_ops="$(agent-browser eval "$ops_total" | tail -1)"; have_ops="$(agent-browser eval "$ops_rows" | tail -1)"
    [ "${have_ops:-0}" -lt "${want_ops:-0}" ] || break
    agent-browser eval "$expand_ops" >/dev/null; sleep 3
  done
  echo "   operations visible: ${have_ops:-?} of ${want_ops:-?}"
  # viewport shot of the fully expanded durable operations tree
  agent-browser eval '(()=>{const h=[...document.querySelectorAll("h2")].find(x=>/^Durable operations/.test(x.innerText));if(h)h.scrollIntoView({block:"start"});return !!h})()' >/dev/null; sleep 1
  agent-browser screenshot "$IMG/$num-exec-operations.png" >/dev/null; echo "   saved $num-exec-operations.png"
  agent-browser eval '(()=>{window.scrollTo(0,0);document.querySelectorAll("*").forEach(e=>{if(e.scrollTop)e.scrollTop=0});return 1})()' >/dev/null
  total0="$(agent-browser eval "$event_count" | tail -1)"; if [ "${total0:-0}" -gt 25 ]; then want="25 history"; else want="50 history"; fi
  setpref -1 "$want"                              # events table: 50 per page, or 25 for long executions
  page=1
  total="$(agent-browser eval "$event_count" | tail -1)"; rows="$(agent-browser eval '(()=>{const ts=document.querySelectorAll("table");const t=ts[ts.length-1];return t.querySelectorAll("tbody > tr").length})()' | tail -1)"
  echo "   events=$total"
  pages=$(( (${total:-0} + 24) / 25 )); [ "${total:-0}" -le 25 ] || true; [ "$pages" -ge 1 ] || pages=1
  [ "${total:-0}" -gt 25 ] || pages=1
  while :; do
    agent-browser eval "$expand_events" >/dev/null; sleep 2
    n="$(agent-browser eval '(()=>{const ts=document.querySelectorAll("table");const t=ts[ts.length-1];return [...t.querySelectorAll("button")].filter(b=>b.getAttribute("aria-expanded")==="true"&&/^Collapse/i.test(b.getAttribute("aria-label")||b.innerText)).length})()' | tail -1)"
    # tall viewport instead of --full: the console shell is fixed-height, --full repeats its header/footer
    h=$(( 900 + ${n:-10} * 500 )); [ "$h" -le 15500 ] || h=15500
    agent-browser set viewport 1600 "$h" >/dev/null; sleep 2
    agent-browser eval '(()=>{window.scrollTo(0,0);document.querySelectorAll("*").forEach(e=>{if(e.scrollTop)e.scrollTop=0});return 1})()' >/dev/null; sleep 1
    agent-browser screenshot "$IMG/$num-exec-events-p$page.png" >/dev/null
    agent-browser set viewport 1600 1200 >/dev/null; sleep 1
    echo "   saved $num-exec-events-p$page.png ($n events expanded on this page, height $h)"
    [ "$page" -lt "$pages" ] || break
    agent-browser eval "$next_page" >/dev/null; page=$((page+1)); sleep 3
  done
  agent-browser reload >/dev/null 2>&1 || true; sleep 4
done
