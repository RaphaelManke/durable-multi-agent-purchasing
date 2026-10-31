#!/usr/bin/env bash
# Run the step 12 queries. Usage: run.sh <query-file> <start-epoch> <end-epoch> <log-group>...
set -euo pipefail
export AWS_PROFILE=otel-playground AWS_REGION=eu-central-1
q="$1"; s="$2"; e="$3"; shift 3
name=$(basename "$q" .logsinsights)
qid=$(aws logs start-query --log-group-names "$@" --start-time "$s" --end-time "$e" \
  --query-string "$(grep -v '^#' "$q")" --query queryId --output text)
for i in $(seq 1 30); do
  st=$(aws logs get-query-results --query-id "$qid" --query status --output text)
  [ "$st" = Complete ] && break; sleep 3
done
aws logs get-query-results --query-id "$qid" --output json > "results/$name.json"
echo "$name status=$st rows=$(python3 -c "import json;print(len(json.load(open('results/$name.json'))['results']))")"
