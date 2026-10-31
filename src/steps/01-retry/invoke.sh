#!/usr/bin/env bash
# Invoke dfdemo-01-retry:live and capture artifacts/. See scripts/lib/invoke-step.sh.
STEP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUNCTION_NAME=dfdemo-01-retry
TIMEOUT_SECONDS=120
source "$STEP_DIR/../../../scripts/lib/invoke-step.sh"
