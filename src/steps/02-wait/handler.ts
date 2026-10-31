/**
 * Step 02: step 01 plus a wait operation.
 *
 * context.wait suspends the execution. No compute is running and no
 * duration is billed while it waits. Compare the REPORT "Billed Duration"
 * lines in CloudWatch against the wall-clock duration of the execution.
 */

import {
  withDurableExecution,
  createRetryStrategy,
  type DurableContext,
} from '@aws/durable-execution-sdk-js'

interface WaitEvent {
  name?: string
  waitSeconds?: number
}

export const handler = withDurableExecution(async (
  event: WaitEvent,
  context: DurableContext
): Promise<Record<string, unknown>> => {
  const waitSeconds = event.waitSeconds ?? 60
  console.log(JSON.stringify({ event: 'handler_invoked', requestId: context.lambdaContext.awsRequestId }))

  const greeting = await context.step('prepare', async () => {
    console.log(JSON.stringify({ event: 'prepare_body_executed' }))
    return `Hello, ${event.name ?? 'durable world'}`
  })

  const flaky = await context.step('flaky', async (stepCtx) => {
    console.log(JSON.stringify({ event: 'flaky_body_executed', attempt: stepCtx.attempt }))
    if (stepCtx.attempt < 2) {
      throw new Error('Simulated transient failure on attempt 1')
    }
    return { succeededOnAttempt: stepCtx.attempt }
  }, {
    retryStrategy: createRetryStrategy({
      maxAttempts: 3,
      initialDelay: { seconds: 1 },
      maxDelay: { seconds: 5 },
      backoffRate: 2.0,
    }),
  })

  // The function is not running while it waits.
  await context.wait('cooldown', { seconds: waitSeconds })

  const finished = await context.step('finish', async () => {
    console.log(JSON.stringify({ event: 'finish_body_executed' }))
    return 'done'
  })

  return { status: 'completed', greeting, flaky, waitSeconds, finished }
})
