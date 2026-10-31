/**
 * Step 01: the first durable function.
 *
 * Two durable steps. The second fails on its first attempt, is retried, and
 * succeeds. Every handler invocation replays from the top: completed steps
 * return their checkpointed result without running their body again.
 *
 * Plain console.log is used on purpose (not context.logger) so that every
 * execution of a step body is visible in CloudWatch, and replayed steps are
 * visibly silent.
 */

import {
  withDurableExecution,
  createRetryStrategy,
  type DurableContext,
} from '@aws/durable-execution-sdk-js'

interface RetryEvent {
  name?: string
}

export const handler = withDurableExecution(async (
  event: RetryEvent,
  context: DurableContext
): Promise<Record<string, unknown>> => {
  console.log(JSON.stringify({ event: 'handler_invoked', requestId: context.lambdaContext.awsRequestId }))

  const greeting = await context.step('prepare', async () => {
    console.log(JSON.stringify({ event: 'prepare_body_executed' }))
    return `Hello, ${event.name ?? 'durable world'}`
  })

  const result = await context.step('flaky', async (stepCtx) => {
    console.log(JSON.stringify({ event: 'flaky_body_executed', attempt: stepCtx.attempt }))
    if (stepCtx.attempt < 2) {
      throw new Error('Simulated transient failure on attempt 1')
    }
    return { greeting, succeededOnAttempt: stepCtx.attempt }
  }, {
    retryStrategy: createRetryStrategy({
      maxAttempts: 3,
      initialDelay: { seconds: 1 },
      maxDelay: { seconds: 5 },
      backoffRate: 2.0,
    }),
  })

  return { status: 'completed', ...result }
})
