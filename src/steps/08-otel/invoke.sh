#!/usr/bin/env bash
# Invoke dfdemo-08-otel-coordinator:live and capture artifacts/. See scripts/lib/invoke-step.sh.
STEP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUNCTION_NAME=dfdemo-08-otel-coordinator
TIMEOUT_SECONDS=900
source "$STEP_DIR/../../../scripts/lib/invoke-step.sh"
