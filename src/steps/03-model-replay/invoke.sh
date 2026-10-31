#!/usr/bin/env bash
# Invoke dfdemo-03-model-replay:live and capture artifacts/. See scripts/lib/invoke-step.sh.
STEP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUNCTION_NAME=dfdemo-03-model-replay
TIMEOUT_SECONDS=300
source "$STEP_DIR/../../../scripts/lib/invoke-step.sh"
