#!/usr/bin/env bash
# Invoke dfdemo-04-agent:live and capture artifacts/. See scripts/lib/invoke-step.sh.
STEP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUNCTION_NAME=dfdemo-04-agent
TIMEOUT_SECONDS=300
source "$STEP_DIR/../../../scripts/lib/invoke-step.sh"
