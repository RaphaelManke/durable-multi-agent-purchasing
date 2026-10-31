#!/usr/bin/env bash
# Invoke dfdemo-10-otel-mode2-coordinator:live and capture artifacts/. See scripts/lib/invoke-step.sh.
STEP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUNCTION_NAME=dfdemo-10-otel-mode2-coordinator
TIMEOUT_SECONDS=900
source "$STEP_DIR/../../../scripts/lib/invoke-step.sh"
