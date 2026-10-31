/**
 * Shared specialist handler.
 *
 * A single Lambda function handler reused across all 5 specialist functions.
 * The PROMPT_NAME environment variable selects which specialist's system prompt
 * and tools to load (price-research, financing, delivery, risk-assessment,
 * contract-review). Most specialists are pure reasoning; some (e.g.
 * price-research) have tools for interacting with external systems.
 *
 * Invoked directly by the coordinator via context.invoke() — no API Gateway.
 * Receives a plain text prompt, returns a plain text response.
 */

import type { Context } from 'aws-lambda'
import { Agent } from '@strands-agents/sdk'
import { createModel, SPECIALIST_MODEL } from '../../lib/models.js'
import { loadPrompt } from '../../lib/prompts.js'
import { loadSpecialistTools } from '../../lib/specialist-tools.js'
import { makeLogger } from '../../lib/logger.js'

const promptName = process.env.PROMPT_NAME!
if (!promptName) throw new Error('PROMPT_NAME environment variable is required')

// Load prompt and model at module scope for cold start optimization.
// BedrockModel is a stateless configuration wrapper — safe to share across requests.
const systemPrompt = loadPrompt(promptName)
const model = createModel(SPECIALIST_MODEL)

/** Event payload from the coordinator's context.invoke() call. */
interface SpecialistEvent {
  prompt: string
}

export const handler = async (
  event: SpecialistEvent,
  context: Context
): Promise<{ response: string }> => {
  const logger = makeLogger({ handler: promptName, requestId: context.awsRequestId })
  const startMs = Date.now()

  try {
    logger.info('request_received', { promptLength: event.prompt.length })

    const tools = loadSpecialistTools(promptName, logger)
    const agent = new Agent({
      model,
      systemPrompt,
      tools,
      printer: false,
    })

    const result = await agent.invoke(event.prompt)
    const response = result.toString()

    logger.info('request_completed', {
      durationMs: Date.now() - startMs,
      responseLength: response.length,
    })

    return { response }
  } catch (err) {
    logger.error('request_failed', {
      durationMs: Date.now() - startMs,
      error: err instanceof Error ? err.message : String(err),
    })

    throw err
  }
}
