/**
 * Coordinator handler — Lambda Durable Functions + Strands Multi-Agent.
 *
 * Four-phase workflow using all four durable execution primitives:
 *
 *   1. step('plan')            — Agent determines which specialists to consult
 *   2. parallel('specialists') — Runs selected specialists concurrently via invoke()
 *   3. step('synthesize')      — Agent synthesizes specialist findings
 *   4. waitForCallback()       — Human approval (conditional, when requireApproval is true)
 *
 * All phases use context.logger (replay-aware) for structured logging.
 *
 * Invoked via: aws lambda invoke --invocation-type Event
 * Results retrieved via: aws lambda get-durable-execution
 */

import {
  withDurableExecution,
  createRetryStrategy,
  JitterStrategy,
  defaultSerdes,
  type DurableContext,
} from '@aws/durable-execution-sdk-js'
import { Agent, tool } from '@strands-agents/sdk'
import { z } from 'zod'
import { createModel, COORDINATOR_MODEL } from '../lib/models.js'
import { loadPrompt } from '../lib/prompts.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Event payload for the coordinator function. */
interface CoordinatorEvent {
  request: string
  requireApproval?: boolean
}

/** Callback payload from human approver. */
interface ApprovalPayload {
  approved: boolean
  notes?: string
}

/** A planned specialist consultation. */
interface SpecialistPlan {
  name: string
  prompt: string
}

/** The analysis plan returned by the planning agent. */
interface AnalysisPlan {
  specialists: SpecialistPlan[]
}

// ---------------------------------------------------------------------------
// Module-scope configuration (initialized once per cold start)
// ---------------------------------------------------------------------------

const planPrompt = loadPrompt('coordinator-plan')
const synthesisPrompt = loadPrompt('coordinator-synthesis')
const model = createModel(COORDINATOR_MODEL)

// Retry strategy for Bedrock steps (plan + synthesize). Handles Bedrock
// throttling with exponential backoff and full jitter.
const bedrockRetry = createRetryStrategy({
  maxAttempts: 3,
  initialDelay: { seconds: 2 },
  maxDelay: { seconds: 30 },
  backoffRate: 2.0,
  jitter: JitterStrategy.FULL,
})

// ---------------------------------------------------------------------------
// Specialist registry
// ---------------------------------------------------------------------------

const SPECIALISTS: Record<string, { functionName: string; display: string }> = {
  'price-research': { functionName: process.env.PRICE_RESEARCH_FUNCTION!, display: 'Price Research' },
  financing: { functionName: process.env.FINANCING_FUNCTION!, display: 'Financing' },
  delivery: { functionName: process.env.DELIVERY_FUNCTION!, display: 'Delivery & Logistics' },
  'risk-assessment': { functionName: process.env.RISK_ASSESSMENT_FUNCTION!, display: 'Risk Assessment' },
  'contract-review': { functionName: process.env.CONTRACT_REVIEW_FUNCTION!, display: 'Contract Review' },
}

// Object key order is insertion order for string keys in V8 — deterministic
// here, but would change if SPECIALISTS were refactored to a Map or sorted.
const ALL_SPECIALIST_NAMES = Object.keys(SPECIALISTS)

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = withDurableExecution(async (
  event: CoordinatorEvent,
  context: DurableContext
): Promise<Record<string, unknown>> => {
  const requireApproval = event.requireApproval === true

  context.logger.info('request_received', { mode: 'async', requireApproval, promptLength: event.request.length })

  // Phase 1: Plan — the entire planning agent invocation (multiple Bedrock
  // round-trips as the agent reasons about which specialists to call) is
  // wrapped in one step. This means the planning conversation is checkpointed
  // as a single unit — on replay, the cached plan is returned instantly
  // without re-invoking Bedrock. We don't checkpoint intermediate reasoning
  // because only the final plan matters.
  const plan = await context.step<AnalysisPlan>('plan', async () => {
    // Pattern: use a tool to extract structured output from the agent.
    // The Zod schema enforces the plan shape; the agent's reasoning
    // determines the content. The closure captures the plan so the step
    // can return it as its checkpointed result.
    let capturedPlan: AnalysisPlan | null = null

    const planTool = tool({
      name: 'create_analysis_plan',
      description: 'Create an analysis plan specifying which specialists to consult and what to ask each one.',
      inputSchema: z.object({
        specialists: z.array(z.object({
          name: z.enum(['price-research', 'financing', 'delivery', 'risk-assessment', 'contract-review']),
          prompt: z.string().describe('The specific analysis request for this specialist, including relevant purchase details'),
        })),
      }),
      callback: async (input) => {
        capturedPlan = input
        return `Plan created: consulting ${input.specialists.map((s) => s.name).join(', ')}.`
      },
    })

    const agent = new Agent({ model, systemPrompt: planPrompt, tools: [planTool], printer: false })
    await agent.invoke(event.request)

    // Unrecoverable: if the model didn't call the tool, retrying won't help.
    if (!capturedPlan) throw new Error('Planning agent did not call create_analysis_plan')
    return capturedPlan
  }, { retryStrategy: bedrockRetry })

  const calledNames = plan.specialists.map((s) => SPECIALISTS[s.name]?.display ?? s.name)
  const skippedNames = ALL_SPECIALIST_NAMES
    .filter((n) => !plan.specialists.some((s) => s.name === n))
    .map((n) => SPECIALISTS[n].display)

  context.logger.info('plan_created', {
    specialistsCalled: calledNames,
    specialistsSkipped: skippedNames,
  })

  // Phase 2: Consult specialists in parallel.
  // context.invoke() is the SDK's built-in primitive for calling other Lambda
  // functions. It checkpoints the result automatically and suspends the
  // coordinator while waiting — no compute charges during specialist execution.
  // Each branch is independently checkpointed with retry.
  //
  // Each branch returns { name, response } — no closure mutation. On replay,
  // parallel() returns the cached BatchResult with all return values intact.
  const results = await context.parallel<{ name: string; response: string }>('specialists',
    plan.specialists.map((spec) => ({
      name: spec.name,
      func: async (ctx) => {
        try {
          const specialist = SPECIALISTS[spec.name]
          if (!specialist) {
            throw new Error(`Unknown specialist: ${spec.name}`)
          }
          const result = await ctx.invoke<{ prompt: string }, { response: string }>(
            spec.name,
            specialist.functionName,
            { prompt: spec.prompt }
          )
          return { name: spec.name, response: result.response }
        } catch (err) {
          // Graceful degradation: return failure message so the synthesis
          // agent can note the gap instead of the entire parallel block failing.
          const display = SPECIALISTS[spec.name]?.display ?? spec.name
          return { name: spec.name, response: `[${display} unavailable: ${err instanceof Error ? err.message : 'unknown error'}]` }
        }
      },
    }))
  )

  // Build specialistResults from checkpointed return values — safe on replay.
  const specialistResults: Record<string, string> = {}
  for (const item of results.succeeded()) {
    specialistResults[item.result.name] = item.result.response
  }

  context.logger.info('specialists_completed', { count: plan.specialists.length })

  // Phase 3: Synthesize — like the plan step, the entire synthesis agent
  // invocation is one checkpointed unit. On replay, the cached recommendation
  // is returned without re-invoking Bedrock.
  const response = await context.step('synthesize', async () => {
    const findings = plan.specialists
      .map((spec) => {
        const display = SPECIALISTS[spec.name]?.display ?? spec.name
        const result = specialistResults[spec.name] ?? '(no response)'
        return `## ${display}\n${result}`
      })
      .join('\n\n')

    const synthesisInput = `Purchase request: ${event.request}\n\nSpecialist findings:\n\n${findings}`

    const agent = new Agent({ model, systemPrompt: synthesisPrompt, printer: false })
    const result = await agent.invoke(synthesisInput)
    const text = result.toString()
    if (!text || text === '[object Object]') {
      throw new Error('Synthesis agent returned empty response')
    }
    return text
  }, { retryStrategy: bedrockRetry })

  const routing = { called: calledNames, skipped: skippedNames }

  context.logger.info('recommendation_generated', { responseLength: response.length })

  // Human approval gate — function suspends here and compute charges stop.
  // Resume via: aws lambda send-durable-execution-callback-success
  if (requireApproval) {
    context.logger.info('awaiting_approval')

    const approval = await context.waitForCallback<ApprovalPayload>(
      'approval',
      async (callbackId) => {
        // In production: send notification (Slack, email, SNS) with the
        // callbackId and recommendation for the approver to review.
        context.logger.info('approval_callback_created', { callbackId })
      },
      { timeout: { hours: 24 }, serdes: defaultSerdes }
    )

    context.logger.info('approval_received', { approved: approval.approved, notes: approval.notes })

    if (!approval.approved) {
      return {
        status: 'rejected',
        recommendation: response,
        routing,
        approverNotes: approval.notes,
      }
    }
  }

  // In production, wrap your persistence call in a context.step() so it's
  // checkpointed and not re-executed on replay:
  //   await context.step('save-recommendation', async () => {
  //     await dynamodb.send(new PutCommand({ TableName: '...', Item: { ... } }))
  //   })
  context.logger.info('recommendation_saved', { routing })

  context.logger.info('request_completed')

  return {
    status: requireApproval ? 'approved' : 'completed',
    recommendation: response,
    routing,
  }
})
