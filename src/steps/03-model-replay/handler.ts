/**
 * Step 03: model calls inside durable steps are replayed, not re-invoked.
 *
 *   Step A: Bedrock call. Succeeds once, is checkpointed.
 *   Step B: Bedrock call that fails on its first attempt(s) and is retried.
 *
 * When B is retried, the handler runs again from the top. Step A returns the
 * checkpointed text without calling Bedrock. Expected Bedrock calls: A once,
 * B (failStepBAttempts + 1) times.
 *
 * SDK 3.x exposes the attempt number to the step body as stepCtx.attempt, so
 * no flag-plus-error-type workaround is needed. failStepBAttempts in the
 * request controls how many attempts of B fail (default 1).
 *
 * The failure is raised AFTER the Bedrock call returns, so the retried
 * attempt visibly repeats the model call (new x-amzn-requestid).
 */

import {
  withDurableExecution,
  type DurableContext,
} from '@aws/durable-execution-sdk-js'
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'
import { SPECIALIST_MODEL } from '../../lib/models.js'

interface ModelReplayEvent {
  prompt?: string
  failStepBAttempts?: number
}

class SimulatedStepFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SimulatedStepFailure'
  }
}

const MODEL_ID = process.env.MODEL_ID ?? SPECIALIST_MODEL
const client = new BedrockRuntimeClient({})

async function converse(prompt: string): Promise<{ text: string; bedrockRequestId: string }> {
  const response = await client.send(new ConverseCommand({
    modelId: MODEL_ID,
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens: 120, temperature: 0 },
  }))
  const text = response.output?.message?.content?.map((c) => c.text ?? '').join('') ?? ''
  return { text, bedrockRequestId: response.$metadata.requestId ?? 'unknown' }
}

export const handler = withDurableExecution(async (
  event: ModelReplayEvent,
  context: DurableContext
): Promise<Record<string, unknown>> => {
  const failStepBAttempts = event.failStepBAttempts ?? 1
  const prompt = event.prompt ?? 'In one sentence, explain what a checkpoint is in a durable workflow.'
  console.log(JSON.stringify({ event: 'handler_invoked', requestId: context.lambdaContext.awsRequestId }))

  const a = await context.step('model-a', async () => {
    const { text, bedrockRequestId } = await converse(prompt)
    console.log(JSON.stringify({ event: 'step_a_bedrock_call', bedrockRequestId }))
    return text
  })

  const b = await context.step('model-b', async (stepCtx) => {
    const { text, bedrockRequestId } = await converse(`Shorten this to five words: ${a}`)
    console.log(JSON.stringify({ event: 'step_b_bedrock_call', attempt: stepCtx.attempt, bedrockRequestId }))
    if (stepCtx.attempt <= failStepBAttempts) {
      throw new SimulatedStepFailure(`Simulated failure of step B on attempt ${stepCtx.attempt}`)
    }
    return text
  }, {
    retryStrategy: (error, attemptCount) =>
      error.name === 'SimulatedStepFailure' && attemptCount <= failStepBAttempts
        ? { shouldRetry: true, delay: { seconds: 2 } }
        : { shouldRetry: false },
  })

  return { status: 'completed', modelId: MODEL_ID, stepA: a, stepB: b, failStepBAttempts }
})
