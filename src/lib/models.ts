import { BedrockModel } from '@strands-agents/sdk'

// Model IDs are set by the SAM template via environment variables.
// The template prepends the global. prefix for cross-region inference.
// Coordinator and risk-assessment use Sonnet 4.6 (stronger reasoning);
// other specialists use Haiku 4.5 (faster, cheaper for routine tasks).
//
// Per-agent model selection happens in template.yaml: risk-assessment's
// SPECIALIST_MODEL_ID is set to global.${AdvancedSpecialistModelId} (Sonnet 4.6)
// while other specialists use global.${SpecialistModelId} (Haiku 4.5). The code
// here just reads whatever the template provides.
export const COORDINATOR_MODEL = process.env.COORDINATOR_MODEL_ID
  ?? 'global.anthropic.claude-sonnet-4-6'

export const SPECIALIST_MODEL = process.env.SPECIALIST_MODEL_ID
  ?? 'global.anthropic.claude-haiku-4-5-20251001-v1:0'

export const createModel = (modelId: string) =>
  new BedrockModel({ modelId })
