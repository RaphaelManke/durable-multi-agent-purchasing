# Step 03 evidence: model calls are replayed, not re-invoked

Execution: id `fa4cab4c-0aed-3898-bf48-1df156818abc` (durable execution name `2a254ee5-8352-423d-b2c4-2d6aee575b47`), status SUCCEEDED.
ARN: `arn:aws:lambda:eu-central-1:913524906826:function:dfdemo-03-model-replay:2/durable-execution/2a254ee5-8352-423d-b2c4-2d6aee575b47/fa4cab4c-0aed-3898-bf48-1df156818abc`
Lambda request id (async invoke, x-amzn-RequestId): `2090852f-69ce-4103-9c11-c5121b16e8c2`. Request: `failStepBAttempts: 1`.

SDK note: the attempt number IS exposed (`stepCtx.attempt`), so no error-type-plus-flag workaround was needed for the attempt counter. The retry strategy still filters on the error name `SimulatedStepFailure`; the failure is thrown after the Bedrock call returns.

## (a) Durable history (history.json)
| EventId | Event | Step | Detail |
|---|---|---|---|
| 2 | StepStarted | model-a | |
| 3 | StepSucceeded | model-a | `RetryDetails.CurrentAttempt: 1`. The only model-a StepSucceeded; no second StepStarted for model-a. |
| 4 | StepStarted | model-b | |
| 5 | StepFailed | model-b | `CurrentAttempt: 1`, `NextAttemptDelaySeconds: 2` |
| 6 | InvocationCompleted | | end of invocation 1 |
| 7 | StepStarted | model-b | attempt 2 (model-a is not started again) |
| 8 | StepSucceeded | model-b | `CurrentAttempt: 2` |
| 9, 10 | InvocationCompleted, ExecutionSucceeded | | |

## (b) Plain console.log in CloudWatch (logs.txt)
- Step A body log `step_a_bedrock_call` appears once: line 4, Bedrock x-amzn-requestid `900c5254-190f-46d8-a1b9-5167903dde7f`.
- Step B body log `step_b_bedrock_call` appears twice: line 5 (attempt 1, `dd047786-60ea-4737-94db-c59510c9639a`) and line 9 (attempt 2, `54a46a9c-4f6a-46c6-bec9-a98c306d28d6`).
- The second invocation (lines 7-9) has `handler_invoked` and the step B log only; there is no `step_a_bedrock_call`, so A was replayed from the checkpoint.

## (c) Invocation and Bedrock call counts
- Bedrock calls: 3 (A once, B twice), three distinct request ids above.
- Handler invocations: **2**, not 3. logs.txt has two `handler_invoked` (lines 3 and 8, Lambda request ids `406863ae-aa7f-4d5f-8bb3-abac471dd8d3` and `c602406a-6cf6-4193-be3e-81912a6f8c8b`) and history.json has two InvocationCompleted before ExecutionSucceeded. With one failed attempt of B the handler runs twice; the brief's "3 invocations" would need `failStepBAttempts: 2`. The request was left as specified (1).

## (d) A's output identical across invocations
- history.json truncates step results (`"Result":{"Truncated":true}`), so the text is not in the history.
- A's body ran once (b), and its checkpointed text is what invocation 2 used to build B's prompt. The final result in execution.json carries `stepA`: "A checkpoint is a saved state of a workflow that allows it to resume from that point if interrupted, rather than restarting from the beginning."
- Limit: the handler does not log A's text in each invocation, so identity across invocations is shown by A running once and being returned from the checkpoint, not by comparing two printed strings.
