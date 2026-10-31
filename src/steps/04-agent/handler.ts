/**
 * Step 04: the first Strands agent inside one durable function.
 *
 * The whole agent loop (model calls and tool calls) runs inside one durable
 * step, so its final answer is checkpointed as a single unit.
 */

import {
  withDurableExecution,
  createRetryStrategy,
  type DurableContext,
} from '@aws/durable-execution-sdk-js'
import { Agent, tool } from '@strands-agents/sdk'
import { z } from 'zod'
import { createModel, SPECIALIST_MODEL } from '../../lib/models.js'

interface AgentEvent {
  request: string
}

const model = createModel(process.env.AGENT_MODEL_ID ?? SPECIALIST_MODEL)

const monthlyPayment = tool({
  name: 'monthly_payment',
  description: 'Calculate the monthly payment of a loan with a fixed annual interest rate.',
  inputSchema: z.object({
    principal: z.number().describe('Loan amount'),
    annualRatePercent: z.number().describe('Annual interest rate in percent'),
    months: z.number().describe('Loan term in months'),
  }),
  callback: async ({ principal, annualRatePercent, months }) => {
    const r = annualRatePercent / 100 / 12
    const payment = r === 0 ? principal / months : (principal * r) / (1 - Math.pow(1 + r, -months))
    return `Monthly payment: ${payment.toFixed(2)}`
  },
})

const bedrockRetry = createRetryStrategy({
  maxAttempts: 3,
  initialDelay: { seconds: 2 },
  maxDelay: { seconds: 30 },
  backoffRate: 2.0,
})

export const handler = withDurableExecution(async (
  event: AgentEvent,
  context: DurableContext
): Promise<Record<string, unknown>> => {
  const answer = await context.step('agent', async () => {
    const agent = new Agent({
      model,
      systemPrompt: 'You are a concise purchasing assistant. Use the monthly_payment tool for any loan calculation.',
      tools: [monthlyPayment],
      printer: false,
    })
    const result = await agent.invoke(event.request)
    return result.toString()
  }, { retryStrategy: bedrockRetry })

  return { status: 'completed', answer }
})
