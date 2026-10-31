#!/usr/bin/env bash
# Invoke dfdemo-02-wait:live and capture artifacts/. See scripts/lib/invoke-step.sh.
STEP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUNCTION_NAME=dfdemo-02-wait
TIMEOUT_SECONDS=300
SAVE_REPORT=1
source "$STEP_DIR/../../../scripts/lib/invoke-step.sh"
