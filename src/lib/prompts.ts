import { coordinatorPlanPrompt } from '../../prompts/coordinator-plan.js'
import { coordinatorSynthesisPrompt } from '../../prompts/coordinator-synthesis.js'
import { priceResearchPrompt } from '../../prompts/price-research.js'
import { financingPrompt } from '../../prompts/financing.js'
import { deliveryPrompt } from '../../prompts/delivery.js'
import { riskAssessmentPrompt } from '../../prompts/risk-assessment.js'
import { contractReviewPrompt } from '../../prompts/contract-review.js'

const prompts: Record<string, string> = {
  'coordinator-plan': coordinatorPlanPrompt,
  'coordinator-synthesis': coordinatorSynthesisPrompt,
  'price-research': priceResearchPrompt,
  financing: financingPrompt,
  delivery: deliveryPrompt,
  'risk-assessment': riskAssessmentPrompt,
  'contract-review': contractReviewPrompt,
}

export function loadPrompt(name: string): string {
  const prompt = prompts[name]
  if (!prompt) throw new Error(`Unknown prompt name: "${name}". Valid names: ${Object.keys(prompts).join(', ')}`)
  return prompt
}
