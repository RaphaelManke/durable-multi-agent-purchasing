#!/usr/bin/env node
/**
 * Generates report/index.html from the recorded artifacts, the final source
 * files and the template. IDs, requests, responses and results are read from
 * src/steps/NN-*\/artifacts at generation time, never typed by hand.
 *
 * Usage: node scripts/gen-report.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const rd = (p) => readFileSync(join(ROOT, p), 'utf8')
const rdJson = (p) => JSON.parse(rd(p))
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---------------------------------------------------------------- helpers
function inline(s) {
  return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

/** Minimal markdown renderer for the evidence files (headings, tables, bullets, paragraphs). */
function md(src) {
  const out = []
  const lines = src.split('\n')
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (/^#{1,3} /.test(l)) {
      const level = l.match(/^#+/)[0].length + 3
      out.push(`<h${level}>${inline(l.replace(/^#+ /, ''))}</h${level}>`)
      i++
    } else if (l.startsWith('|')) {
      const rows = []
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++])
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const [head, , ...body] = rows
      out.push('<table><thead><tr>' + cells(head).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>')
    } else if (l.startsWith('- ')) {
      const items = []
      while (i < lines.length && lines[i].startsWith('- ')) items.push(lines[i++].slice(2))
      out.push('<ul>' + items.map((x) => `<li>${inline(x)}</li>`).join('') + '</ul>')
    } else if (l.trim() === '') {
      i++
    } else {
      const para = []
      while (i < lines.length && lines[i].trim() !== '' && !/^(#|\||- )/.test(lines[i])) para.push(lines[i++])
      out.push(`<p>${inline(para.join(' '))}</p>`)
    }
  }
  return out.join('\n')
}

const code = (text, label) =>
  `<div class="code">${label ? `<div class="label">${esc(label)}</div>` : ''}<pre><code>${esc(text.replace(/\s+$/, ''))}</code></pre></div>`

/** Source text from the first line containing `from` up to and including the first later line containing `to`. */
function excerpt(path, from, to) {
  const lines = rd(path).split('\n')
  const s = lines.findIndex((l) => l.includes(from))
  if (s < 0) throw new Error(`excerpt start not found in ${path}: ${from}`)
  const e = to ? lines.findIndex((l, idx) => idx >= s && (to.startsWith('=') ? l === to.slice(1) : l.includes(to))) : lines.length - 1
  if (e < 0) throw new Error(`excerpt end not found in ${path}: ${to}`)
  return lines.slice(s, e + 1).join('\n')
}

/** Lines of one resource in template.yaml, keeping only the lines that matter for the tracing story. */
function templateExcerpt(resource, keep) {
  const lines = rd('template.yaml').split('\n')
  const s = lines.findIndex((l) => l === `  ${resource}:`)
  if (s < 0) throw new Error(`resource ${resource} not in template.yaml`)
  let e = lines.findIndex((l, i) => i > s && /^ {2}\S/.test(l))
  if (e < 0) e = lines.length
  const block = lines.slice(s, e).filter((l, idx) => idx === 0 || keep.some((k) => l.includes(k)))
  return block.join('\n')
}

/** Truncate long string values so the result fits on a slide. Full text stays in execution.json. */
function shorten(value, max = 500) {
  if (typeof value === 'string') return value.length > max ? `${value.slice(0, max)} [... truncated in report, ${value.length} chars total]` : value
  if (Array.isArray(value)) return value.map((v) => shorten(v, max))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shorten(v, max)]))
  return value
}

const stepDir = (dir) => `src/steps/${dir}/artifacts`
const txt = (dir, f) => rd(`${stepDir(dir)}/${f}`).trim()

function facts(dir) {
  const a = stepDir(dir)
  const exec = rdJson(`${a}/execution.json`)
  const resp = rdJson(`${a}/response.json`)
  const start = Date.parse(exec.StartTimestamp)
  const end = Date.parse(exec.EndTimestamp)
  let result = exec.Result
  try { result = JSON.parse(exec.Result) } catch { /* keep string */ }
  return {
    request: rd(`src/steps/${dir}/request.json`).trim(),
    response: JSON.stringify(resp, null, 2),
    result: JSON.stringify(shorten(result), null, 2),
    requestId: txt(dir, 'request-id.txt'),
    execId: txt(dir, 'durable-execution-id.txt'),
    arn: txt(dir, 'durable-execution-arn.txt'),
    status: exec.Status,
    started: exec.StartTimestamp,
    ended: exec.EndTimestamp,
    wallSeconds: ((end - start) / 1000).toFixed(1),
    fn: exec.FunctionArn.split(':function:')[1],
    traceHeader: exec.TraceHeader?.XAmznTraceId,
    history: (rdJson(`${a}/history.json`).Events ?? rdJson(`${a}/history.json`)).map((e) => e.EventType + (e.Name && !/^[0-9a-f-]{36}$/.test(e.Name) ? `(${e.Name})` : '')),
  }
}

const img = (file, caption) =>
  existsSync(join(ROOT, 'report/img', file))
    ? `<figure><a href="img/${file}"><img loading="lazy" src="img/${file}" alt="${esc(caption)}"></a><figcaption>${esc(caption)}</figcaption></figure>`
    : (() => { throw new Error(`missing screenshot ${file}`) })()

// ---------------------------------------------------------------- step definitions
const steps = [
  {
    n: '01', dir: '01-retry', title: 'The first durable function: retry, checkpoint, replay', group: 'What are durable functions?',
    outline: 'Show simple code handler. Two steps: the second fails, gets retried, and succeeds. Explain checkpointing and replay.',
    goal: 'Show that a normal Lambda handler wrapped in withDurableExecution survives a failing step. Step "prepare" is checkpointed; step "flaky" fails on attempt 1, is retried after a delay, and succeeds on attempt 2 without re-running "prepare".',
    codeFile: 'src/steps/01-retry/handler.ts', code: () => excerpt('src/steps/01-retry/handler.ts', 'export const handler', '  return { status'),
    say: [
      'This is a plain Lambda handler. The only change is the withDurableExecution wrapper and context.step around the work.',
      'Each step is checkpointed when it succeeds. Step "prepare" runs once; its result is stored.',
      'Step "flaky" throws on attempt 1. The SDK records StepFailed, ends the invocation and starts a new one after the retry delay (1 s here).',
      'The new invocation replays the handler from the top. "prepare" returns its stored result without running its body; only "flaky" runs again, now with attempt 2.',
      'Look at the logs: prepare_body_executed appears once, flaky_body_executed twice, handler_invoked twice.',
    ],
    prompt: `Write an AWS Lambda durable function in TypeScript (ESM) using @aws/durable-execution-sdk-js v3: \`withDurableExecution(async (event, context) => ...)\`.
Event: { name?: string }.
1. Log JSON { event: "handler_invoked", requestId: context.lambdaContext.awsRequestId } with plain console.log (not context.logger) so every execution is visible in CloudWatch.
2. context.step("prepare") logs { event: "prepare_body_executed" } and returns \`Hello, \${event.name ?? "durable world"}\`.
3. context.step("flaky", async (stepCtx) => ...) logs { event: "flaky_body_executed", attempt: stepCtx.attempt }, throws Error("Simulated transient failure on attempt 1") while stepCtx.attempt < 2, otherwise returns { greeting, succeededOnAttempt: stepCtx.attempt }. Give it retryStrategy: createRetryStrategy({ maxAttempts: 3, initialDelay: { seconds: 1 }, maxDelay: { seconds: 5 }, backoffRate: 2.0 }).
4. Return { status: "completed", ...result }.
Add a header comment that explains checkpoint and replay. Also add it as a SAM function dfdemo-01-retry (256 MB, 30 s timeout, DurableConfig ExecutionTimeout 300, AutoPublishAlias live) and a request.json { "name": "durable world" }.`,
    shots: [['01-lambda-function.png', 'Lambda function page: type Durable'], ['01-durable-executions.png', 'Durable executions tab with the recorded run'], ['01-cloudwatch-logs.png', 'CloudWatch log events: handler_invoked twice, flaky body twice']],
    extra: (f) => `<p class="note">History event sequence (history.json): <code>${esc(f.history.join(' → '))}</code>. <code>StepFailed(flaky)</code> then a second <code>StepStarted(flaky)</code>, but no second <code>StepStarted(prepare)</code>.</p>
${code(rd(`${stepDir('01-retry')}/logs.txt`).split('\n').filter((l) => l.includes('event')).map((l) => l.replace(/^\d+ /, '')).join('\n'), 'logs.txt (application events only)')}`,
  },
  {
    n: '02', dir: '02-wait', title: 'Add a wait operation: you do not pay for waiting', group: 'What are durable functions?',
    outline: 'Extend the Lambda with a wait operation. Execute it and look at the billed duration. Takeaway: you don\'t pay for wait time.',
    goal: 'Extend step 01 with context.wait("cooldown", 60 s). Compare the wall-clock duration of the execution (about 61 s) with the sum of billed durations of the handler invocations (179 ms).',
    codeFile: 'src/steps/02-wait/handler.ts', code: () => excerpt('src/steps/02-wait/handler.ts', '  // The function is not running while it waits.', "  return { status"),
    say: [
      'Same handler as before, plus one line: context.wait with 60 seconds.',
      'When the wait starts, the invocation ends. Nothing runs and nothing is billed until the timer fires and a new invocation replays the handler.',
      'Wall clock for the execution: 61.357 s. Billed: three invocations, 71 + 67 + 41 = 179 ms.',
      'Takeaway: you do not pay for the wait time. This is why durable functions suit waits of minutes, hours or days.',
    ],
    prompt: `Extend the step 01 durable function into dfdemo-02-wait. Event: { name?: string, waitSeconds?: number } with waitSeconds defaulting to 60.
Keep the "prepare" step and the "flaky" step (fails on attempt 1, retry strategy maxAttempts 3, initialDelay 1 s, maxDelay 5 s, backoffRate 2.0; returns { succeededOnAttempt: stepCtx.attempt }).
After "flaky" add \`await context.wait("cooldown", { seconds: waitSeconds })\`, then a step "finish" that logs { event: "finish_body_executed" } and returns "done".
Return { status: "completed", greeting, flaky, waitSeconds, finished }.
Comment that the function is not running while it waits. SAM: dfdemo-02-wait, 256 MB, 30 s timeout, DurableConfig ExecutionTimeout 900, alias live; request.json { "name": "durable world", "waitSeconds": 60 }.
Provide a script that captures the Lambda REPORT duration and billed duration for each invocation and compares their sum with the execution's wall-clock time.`,
    shots: [['02-lambda-function.png', 'Lambda function page'], ['02-durable-executions.png', 'Durable executions tab: execution duration about 61 s'], ['02-cloudwatch-logs.png', 'CloudWatch log events across the wait']],
    extra: () => `<h4>REPORT lines (billed duration) versus wall clock</h4>${code(txt('02-wait', 'report.txt'), 'report.txt')}${md(rd(`${stepDir('02-wait')}/wallclock-vs-billed.md`))}
<div class="callout"><strong>Billed 179 ms of 61 357 ms wall clock (0.29 %).</strong> The 60 s wait added 0 ms of billed duration.</div>`,
  },
  {
    n: '03', dir: '03-model-replay', title: 'Invoke a model, fail, retry: the first call is replayed, not re-invoked', group: 'What are durable functions?',
    outline: 'Invoke a model async, then wait. Tries to set the result. (Reworked per the presenter\'s decision: step B fails once and is retried; step A\'s model call is replayed from its checkpoint.)',
    goal: 'Two Bedrock calls in two durable steps. Step A succeeds and is checkpointed. Step B calls Bedrock, then fails on its first attempt (request flag failStepBAttempts: 1) and is retried. The retry shows that A\'s model call is not made again: it is replayed from the checkpoint.',
    codeFile: 'src/steps/03-model-replay/handler.ts', code: () => excerpt('src/steps/03-model-replay/handler.ts', "  const a = await context.step('model-a'", "  return { status"),
    say: [
      'Step A asks the model for a one-sentence answer. The answer is checkpointed.',
      'Step B asks the model to shorten A\'s answer, then throws SimulatedStepFailure on attempt 1. The failure is raised after the model returned, so the retry visibly repeats the model call.',
      'On the retry the handler replays from the top. Step A returns the stored text with no Bedrock call. Only B calls the model again.',
      'Evidence (a) to (d) below: three Bedrock request IDs, A logged once, B logged twice, same A output.',
      'Correction to the brief: the handler ran twice, not three times. One failed attempt means two invocations; three would need failStepBAttempts: 2.',
    ],
    prompt: `Create a durable Lambda dfdemo-03-model-replay (TypeScript ESM, @aws/durable-execution-sdk-js, @aws-sdk/client-bedrock-runtime) that proves model calls are replayed from checkpoints, not re-invoked.
Event: { prompt?: string, failStepBAttempts?: number } (defaults: "In one sentence, explain what a checkpoint is in a durable workflow.", 1).
Model: process.env.MODEL_ID ?? SPECIALIST_MODEL from ../../lib/models.js. A helper converse(prompt) uses ConverseCommand with maxTokens 120, temperature 0 and returns { text, bedrockRequestId: response.$metadata.requestId }.
Define class SimulatedStepFailure extends Error with name "SimulatedStepFailure".
Handler: log { event: "handler_invoked", requestId }. Step "model-a": converse(prompt), log { event: "step_a_bedrock_call", bedrockRequestId }, return text. Step "model-b" (receives stepCtx): converse("Shorten this to five words: " + a), log { event: "step_b_bedrock_call", attempt: stepCtx.attempt, bedrockRequestId }, then throw SimulatedStepFailure while stepCtx.attempt <= failStepBAttempts; otherwise return text. Use a custom retryStrategy: retry with a 2 s delay only for error.name === "SimulatedStepFailure" and attemptCount <= failStepBAttempts, else shouldRetry false.
Return { status: "completed", modelId, stepA, stepB, failStepBAttempts }. Note in a header comment that stepCtx.attempt exposes the attempt number in SDK 3.x.
SAM: 512 MB, 60 s, bedrock:InvokeModel permissions for the specialist (Haiku) model. request.json: { "prompt": "In one sentence, explain what a checkpoint is in a durable workflow.", "failStepBAttempts": 1 }.`,
    shots: [['03-lambda-function.png', 'Lambda function page'], ['03-durable-executions.png', 'Durable executions tab'], ['03-cloudwatch-logs.png', 'CloudWatch log events: step A once, step B twice']],
    extra: () => `<h4>Evidence (a) to (d)</h4><div class="evidence">${md(rd(`${stepDir('03-model-replay')}/evidence.md`).replace(/^# .*\n/, ''))}</div>`,
  },
  {
    n: '04', dir: '04-agent', title: 'First agent with the Strands SDK', group: 'What are durable functions?',
    outline: 'Introduce the Strands SDK to build the first agent.',
    goal: 'Run a Strands Agent with one tool (monthly_payment) inside one durable step. The whole agent loop (model calls and tool calls) is checkpointed as a single unit.',
    codeFile: 'src/steps/04-agent/handler.ts', code: () => excerpt('src/steps/04-agent/handler.ts', 'const monthlyPayment', "  return { status"),
    say: [
      'A Strands agent is a model, a system prompt and tools. Here the tool computes a loan payment.',
      'The agent runs inside context.step("agent"). Model calls and tool calls happen inside the step; only the final answer is checkpointed.',
      'If the step fails, the retry strategy (3 attempts, exponential backoff) re-runs the whole loop. If it succeeds, a replay never calls the model again.',
      'The answer is $66.48 per month, computed by the tool, not guessed by the model.',
    ],
    prompt: `Create a durable Lambda dfdemo-04-agent (TypeScript ESM) with @aws/durable-execution-sdk-js, @strands-agents/sdk and zod.
Define a Strands tool "monthly_payment" ("Calculate the monthly payment of a loan with a fixed annual interest rate.") with a zod input schema { principal: number, annualRatePercent: number, months: number } and the standard annuity formula (r = annualRatePercent/100/12; payment = principal*r/(1-(1+r)^-months), or principal/months if r is 0). It returns \`Monthly payment: \${payment.toFixed(2)}\`.
Model: createModel(process.env.AGENT_MODEL_ID ?? SPECIALIST_MODEL) from ../../lib/models.js.
Handler: event { request: string }. Run \`context.step("agent", ...)\` that builds new Agent({ model, systemPrompt: "You are a concise purchasing assistant. Use the monthly_payment tool for any loan calculation.", tools: [monthlyPayment], printer: false }), calls agent.invoke(event.request) and returns result.toString(). Retry strategy: createRetryStrategy({ maxAttempts: 3, initialDelay 2 s, maxDelay 30 s, backoffRate 2.0 }). Return { status: "completed", answer }.
Explain in a header comment that the whole agent loop is one checkpointed unit. SAM: 1024 MB, 120 s, Bedrock invoke permissions, alias live. request.json: { "request": "I want to finance a $1,500 laptop over 24 months at 6% annual interest. What is my monthly payment?" }.`,
    shots: [['04-lambda-function.png', 'Lambda function page'], ['04-durable-executions.png', 'Durable executions tab'], ['04-cloudwatch-logs.png', 'CloudWatch log events']],
    extra: (f) => `<p class="note">History: <code>${esc(f.history.join(' → '))}</code>. One step, one invocation: the agent loop is invisible to the history except for its final result.</p>`,
  },
  {
    n: '05', dir: '05-split', title: 'Split the agent into multiple Lambdas for permission boundaries', group: 'What are durable functions?',
    outline: 'Split the agent into multiple Lambdas for permission boundaries.',
    goal: 'A coordinator durable function plans, fans out to specialist Lambdas with context.invoke inside context.parallel, and synthesizes. Each specialist is its own function with its own IAM role, so each has only the permissions it needs. No tracing in this step.',
    codeFile: 'src/steps/05-split/coordinator.ts', code: () => excerpt('src/steps/05-split/coordinator.ts', "  const results = await context.parallel", "  context.logger.info('specialists_completed'"),
    say: [
      'The coordinator has three durable phases: plan (an agent picks the specialists), parallel invoke, synthesize.',
      'Each specialist is a separate Lambda. The coordinator role may invoke exactly those five functions and call its Bedrock model. Each specialist role may call only its own Bedrock model.',
      'context.invoke checkpoints the result and suspends the coordinator while the specialist runs, so you do not pay for the coordinator while it waits.',
      'Each branch catches errors and returns an "unavailable" text, so one failed specialist does not fail the whole parallel block.',
      'This run: the planner chose Price Research and Delivery & Logistics for a laptop purchase. The router decided; we did not.',
    ],
    prompt: `Split the purchasing agent into a durable coordinator and five specialist Lambdas (price-research, financing, delivery, risk-assessment, contract-review).
Coordinator (src/steps/05-split/coordinator.ts, TypeScript ESM, withDurableExecution, Strands Agent, zod): event { request: string, requireApproval?: boolean }.
1. context.step("plan"): a Strands Agent with the coordinator-plan prompt and a tool create_analysis_plan (zod: specialists: array of { name: enum of the five specialist keys, prompt: string }). Capture the tool input in a closure, throw if the tool was not called. Retry: createRetryStrategy maxAttempts 3, initialDelay 2 s, maxDelay 30 s, backoffRate 2, JitterStrategy.FULL.
2. context.parallel("specialists", ...) with one branch per planned specialist; each branch calls ctx.invoke(name, functionName, { prompt }) where function names come from env vars PRICE_RESEARCH_FUNCTION, FINANCING_FUNCTION, DELIVERY_FUNCTION, RISK_ASSESSMENT_FUNCTION, CONTRACT_REVIEW_FUNCTION. Wrap each branch in try/catch and return { name, response: "[<display> unavailable: <message>]" } on error. Rebuild results from results.succeeded().
3. context.step("synthesize") with the coordinator-synthesis prompt over "Purchase request: ...\\n\\nSpecialist findings:\\n\\n## <Display>\\n<text>" and the same retry strategy; throw on an empty answer.
4. If requireApproval, await context.waitForCallback("approval", ..., { timeout: { hours: 24 }, serdes: defaultSerdes }) and return status "rejected" when not approved.
Use context.logger for plan_created, specialists_completed, recommendation_generated, request_completed. Return { status: "completed" | "approved", recommendation, routing: { called, skipped } }. Pass \`{ plugins: loadOtelPlugins() }\` as second argument of withDurableExecution (empty list when OTEL_PLUGIN is unset).
Specialist (specialist.ts): one shared handler; env PROMPT_NAME selects the prompt and tools; input { prompt }, output { response }; use SPECIALIST_MODEL.
SAM: generate template.yaml with scripts/gen-template.ts: dfdemo-05-coordinator plus dfdemo-05-{price,financing,delivery,risk,contract}, one IAM role each, coordinator allowed lambda:InvokeFunction only on the five specialists, Bedrock permissions scoped to each function's model, alias live, DurableConfig on the coordinator. request.json: { "request": "I want to buy a 15-inch laptop for software development, budget around $1,500", "requireApproval": false }.`,
    shots: [['05-lambda-function.png', 'Coordinator Lambda function page'], ['05-durable-executions.png', 'Durable executions tab'], ['05-cloudwatch-logs.png', 'Coordinator CloudWatch log events']],
    extra: (f) => `<h4>Permission boundary in the template (coordinator invoke permissions)</h4>${code(excerpt('template.yaml', '  Fn05Coordinator:', '  Fn05Price:').split('\n').filter((l) => /FunctionName|lambda:InvokeFunction|GetAtt|bedrock:|DurableConfig/.test(l)).join('\n'), 'template.yaml (Fn05Coordinator, abridged)')}
<p class="note">History: <code>${esc(f.history.slice(0, 12).join(' → '))}${f.history.length > 12 ? ' → …' : ''}</code> (${f.history.length} events in total).</p>`,
  },
  {
    n: '06', dir: '06-full', title: 'See the full agent in action', group: 'What are durable functions?',
    outline: 'See the full agent in action.',
    goal: 'Run the same coordinator with the demo input (a used 2020 Honda Civic around $18,000). All five specialists are consulted in parallel; the synthesis agent writes the recommendation. Same function as step 05, different input.',
    codeFile: 'src/steps/05-split/coordinator.ts', code: () => excerpt('src/steps/05-split/coordinator.ts', "  const response = await context.step('synthesize'", "  }, { retryStrategy: bedrockRetry })"),
    say: [
      'Same function as step 05. Only the input changes: a used car this time, so the planner picks all five specialists.',
      'The five specialists run in parallel; the coordinator is suspended while they work.',
      'The synthesis step turns five findings into one recommendation with next steps.',
      'Execution took about 69 s wall clock. The result is the recommendation text plus the routing (called/skipped).',
    ],
    prompt: `Using the coordinator from step 05 (deployed as dfdemo-05-coordinator:live), create src/steps/06-full/request.json with { "request": "I want to buy a used 2020 Honda Civic for around $18,000", "requireApproval": false } and an invoke.sh that calls the shared scripts/lib/invoke-step.sh with FUNCTION_NAME=dfdemo-05-coordinator and TIMEOUT_SECONDS large enough for a five-specialist run. The script must invoke asynchronously (--invocation-type Event --payload fileb://request.json) against the alias, poll get-durable-execution until a terminal status, and save request.json, response.json, request-id.txt, durable-execution-arn.txt, durable-execution-id.txt, execution.json, history.json and logs.txt. Fail unless the status is SUCCEEDED.
No new handler code is needed: the full agent is the step 05 coordinator with five specialists.`,
    shots: [['06-lambda-function.png', 'Same Lambda function as step 05'], ['06-durable-executions.png', 'Durable executions tab: the 06 run is the 2f16e5b3… row']],
    extra: () => '',
  },
  {
    n: '07', dir: '07-xray', title: 'Enable X-Ray: only basic tracing info', group: 'Running it at scale!',
    outline: 'Enable X-Ray. Only basic tracing info.',
    goal: 'Duplicate the coordinator and the specialists with Tracing: Active. The same demo input now produces an X-Ray trace. The trace shows Lambda service and function segments, but only basic information.',
    codeFile: 'template.yaml', code: () => templateExcerpt('Fn07XrayCoordinator', ['FunctionName', 'Tracing:', 'AWSXRay', 'Handler', 'CodeUri']),
    say: [
      'Turning on X-Ray is a one-line property: Tracing: Active. The code does not change.',
      'In the trace map you see the coordinator and each specialist as Lambda nodes, with durations and the invoke links.',
      'What you get is basic: Lambda service and function segments and the invocation attempts. Step names, the plan and synthesize phases and retries are not named operations in this trace.',
    ],
    prompt: `In scripts/gen-template.ts add a tracing variant for step 07: a coordinator dfdemo-07-xray-coordinator (same handler src/steps/05-split/coordinator.handler, 1536 MB, 300 s timeout, DurableConfig ExecutionTimeout 86400, RetentionPeriodInDays 7, alias live) and five specialists dfdemo-07-xray-{price,financing,delivery,risk,contract} that reuse specialist.handler. Set Tracing: Active on all of them (no layer, no extra policy). The coordinator env vars must point at the 07 specialists, and its lambda:InvokeFunction permission only at those five. Do not set OTEL_PLUGIN. Regenerate template.yaml (SAM Globals cannot carry Metadata, so the template is generated, not hand-written). request.json: the Honda Civic request used in step 06. Record the X-Ray trace ID (Root=1-...) from the logs in artifacts/trace-ids.txt.`,
    shots: [['07-lambda-function.png', 'Lambda function page with active tracing'], ['07-durable-executions.png', 'Durable executions tab'], ['07-cloudwatch-logs.png', 'CloudWatch log events'], ['07-trace-detail.png', 'X-Ray / CloudWatch trace: segments graph, Durable Execution Attempt spans']],
    extra: (f) => `<p class="note">Trace header of the execution: <code>${esc(f.traceHeader)}</code>. ${esc(txt('07-xray', 'trace-ids.txt').split('\n')[0])}.</p>`,
  },
  {
    n: '08', dir: '08-otel', title: 'Add the OTel plugin and enable the OTel layer', group: 'Running it at scale!',
    outline: 'Add the OTel plugin and enable the OTel layer.',
    goal: 'The coordinator gets the ADOT Node.js Lambda layer, the wrapper script AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler, and the durable OTel plugin (OTEL_PLUGIN=execution, the workflow-centered view). Specialists stay untraced.',
    codeFile: 'src/lib/otel.ts', code: () => excerpt('src/lib/otel.ts', 'export function loadOtelPlugins', '=}'),
    extra2: () => code(templateExcerpt('Fn08OtelCoordinator', ['FunctionName', 'Tracing:', 'Layers:', 'aws-otel-nodejs', 'OTEL_PLUGIN', 'AWS_LAMBDA_EXEC_WRAPPER', 'AWSXRay']), 'template.yaml (Fn08OtelCoordinator, abridged)'),
    say: [
      'Two additions: the OTel layer plus wrapper script, and the durable OTel plugin passed to withDurableExecution.',
      'The plugin turns durable operations into spans: execution, steps, invokes, retries, waits. The layer exports them.',
      'The coordinator code is the same file as step 05; the plugin is selected by the OTEL_PLUGIN environment variable.',
      'ExecutionOtelPlugin gives a workflow-centered view: one trace for the whole execution across invocations.',
    ],
    prompt: `Add OpenTelemetry tracing to the durable coordinator.
1. src/lib/otel.ts: export loadOtelPlugins(): DurableInstrumentationPluginFactory[]. It reads process.env.OTEL_PLUGIN: unset returns []; "execution" returns [createExecutionOtelPluginFactory()]; "invocation" returns [createInvocationOtelPluginFactory()]; anything else throws Error('Unknown OTEL_PLUGIN value: "<value>"'). Import the factories from @aws/durable-execution-sdk-js-otel. Document that the OTel provider comes from the Lambda layer.
2. In the coordinator pass \`{ plugins }\` (from loadOtelPlugins() at module scope) as the second argument of withDurableExecution.
3. In scripts/gen-template.ts add step 08: dfdemo-08-otel-coordinator with Tracing: Active, the ADOT layer arn:aws:lambda:\${AWS::Region}:901920570463:layer:aws-otel-nodejs-arm64-ver-1-30-2:6, env AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler and OTEL_PLUGIN=execution, and the AWSXRayDaemonWriteAccess policy. Specialists dfdemo-08-otel-{price,financing,delivery,risk,contract} are plain (no tracing) and will be reused by step 10. Regenerate template.yaml.
request.json: the Honda Civic request. Record the trace ID in artifacts/trace-ids.txt.`,
    shots: [['08-lambda-function.png', 'Lambda function page with the OTel layer'], ['08-durable-executions.png', 'Durable executions tab'], ['08-cloudwatch-logs.png', 'CloudWatch log events (OTel extension start-up lines)']],
    extra: (f) => `<p class="note">Trace header: <code>${esc(f.traceHeader)}</code>.</p>`,
  },
  {
    n: '09', dir: '08-otel', title: 'See traces in CloudWatch', group: 'Running it at scale!', noInvoke: true,
    outline: 'See traces in CloudWatch.',
    goal: 'Open the trace of the step 08 run in CloudWatch (Application Signals / Transaction Search): trace map, segments timeline, durable operation spans and the Bedrock call as its own node. No new function: this step reuses the step 08 execution.',
    codeFile: 'src/steps/09-traces/README.md', code: () => rd('src/steps/09-traces/README.md'),
    say: [
      'Same execution as step 08; we only look at it differently.',
      'The trace has 52 spans in the console view. Durable operations (steps, invokes, retries) appear as named spans, and the Bedrock ConverseStream call is a child span with its own duration.',
      'Transaction Search is enabled in the account, which stores spans in the aws/spans log group so they can be queried (step 12).',
    ],
    prompt: `Write src/steps/09-traces/README.md for the "see traces in CloudWatch" step. It has no function. State that the traces come from the step 08 run (../08-otel/artifacts/) and tell the presenter how to open them: CloudWatch console, Application Signals, Transaction Search, paste the trace ID from ../08-otel/artifacts/trace-ids.txt, then show the trace map, the segments timeline, the durable operation spans and the Bedrock span. Save console screenshots under report/img.`,
    shots: [['08-trace-detail.png', 'Trace of the step 08 run in CloudWatch: 52 spans, Bedrock node'], ['07-11-trace-map-all.png', 'CloudWatch Trace Map (last 3 h) with the X-Ray and OTel nodes']],
    extra: () => '',
  },
  {
    n: '10', dir: '10-mode', title: 'Switch the tracing mode', group: 'Running it at scale!',
    outline: 'Switch tracing mode.',
    goal: 'A new coordinator function uses InvocationOtelPlugin (OTEL_PLUGIN=invocation, the invocation-centered view) instead of ExecutionOtelPlugin. Only the coordinator changes; it reuses the step 08 specialists.',
    codeFile: 'template.yaml', code: () => templateExcerpt('Fn10OtelMode2Coordinator', ['FunctionName', 'Tracing:', 'Layers:', 'aws-otel-nodejs', 'OTEL_PLUGIN', 'AWS_LAMBDA_EXEC_WRAPPER', 'FUNCTION:']),
    say: [
      'One environment variable decides the mode: OTEL_PLUGIN=invocation instead of execution.',
      'The execution mode builds one trace around the whole workflow. The invocation mode builds traces around each handler invocation.',
      'Compare the two trace screenshots: same work, different shape. Pick the one that matches the question you ask most often.',
      'Specialists are unchanged; they are the step 08 functions.',
    ],
    prompt: `Add step 10 to scripts/gen-template.ts: a coordinator dfdemo-10-otel-mode2-coordinator that is identical to dfdemo-08-otel-coordinator (same handler, ADOT layer, wrapper script, Tracing: Active, AWSXRayDaemonWriteAccess) except OTEL_PLUGIN=invocation. Its env vars and lambda:InvokeFunction permission must point at the existing dfdemo-08-otel-* specialists; do not create new specialists. Regenerate template.yaml. request.json: the Honda Civic request. Record the trace ID in artifacts/trace-ids.txt.`,
    shots: [['10-lambda-function.png', 'Lambda function page'], ['10-durable-executions.png', 'Durable executions tab'], ['10-cloudwatch-logs.png', 'CloudWatch log events'], ['10-trace-detail.png', 'Trace of the mode 2 (invocation) coordinator']],
    extra: (f) => `<p class="note">Trace header: <code>${esc(f.traceHeader)}</code>.</p>`,
  },
  {
    n: '11', dir: '11-all', title: 'Enable tracing for all Lambdas: context propagation', group: 'Running it at scale!',
    outline: 'Enable tracing for all Lambdas. See context propagation.',
    goal: 'Duplicate the specialists with the OTel layer and Tracing: Active too, and a coordinator that invokes them. The specialist spans now join the coordinator\'s trace: one trace, six services.',
    codeFile: 'template.yaml', code: () => templateExcerpt('Fn11OtelPrice', ['FunctionName', 'Tracing:', 'Layers:', 'aws-otel-nodejs', 'AWS_LAMBDA_EXEC_WRAPPER', 'AWSXRay', 'Handler']),
    say: [
      'In step 10 the specialists had no tracing, so they were black boxes. Now every function carries the layer and the wrapper script.',
      'Context propagation: the coordinator\'s trace header travels with the invoke, and each specialist continues the same trace.',
      'The trace has 94 spans in the console view, with the six services in one trace. The slowest branch is the Risk specialist (Sonnet, 43 s Bedrock stream).',
      'Step 12 proves this with a query.',
    ],
    prompt: `Add step 11 to scripts/gen-template.ts: five specialists dfdemo-11-otel-{price,financing,delivery,risk,contract} (specialist.handler, same prompts and models as the other specialists) with Tracing: Active, the ADOT layer arn:aws:lambda:\${AWS::Region}:901920570463:layer:aws-otel-nodejs-arm64-ver-1-30-2:6, AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler and the AWSXRayDaemonWriteAccess policy. Add a coordinator dfdemo-11-otel-all-coordinator (OTEL_PLUGIN=execution, same layer and wrapper) whose env vars and invoke permission point at these five. Regenerate template.yaml. request.json: the Honda Civic request. Record the trace ID in artifacts/trace-ids.txt, then show in the console that the specialist services appear inside the coordinator's trace.`,
    shots: [['11-lambda-function.png', 'Lambda function page'], ['11-durable-executions.png', 'Durable executions tab'], ['11-cloudwatch-logs.png', 'CloudWatch log events'], ['11-trace-detail.png', 'One trace across coordinator and specialists: 94 spans'], ['07-11-trace-map-all.png', 'Trace map with all nodes']],
    extra: (f) => `<p class="note">Trace header: <code>${esc(f.traceHeader)}</code>.</p>`,
  },
]

// ---------------------------------------------------------------- step 12
const Q = '12-analysis/artifacts'
const qtext = (name) => rd(`src/steps/${Q}/queries/${name}.logsinsights`).trim()
const qrows = (name) => rdJson(`src/steps/${Q}/results/${name}.json`).results.map((r) => Object.fromEntries(r.filter((x) => x.field !== '@ptr').map((x) => [x.field, x.value])))
const table = (rows, cols) => rows.length === 0 ? '<p>No rows.</p>' : `<table><thead><tr>${cols.map((c) => `<th>${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(c.f ? c.f(r) : r[c.k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`
const execShort = (arn) => arn.split('/').slice(-2).join(' / ')
const stepOfFn = (log) => ({ '05-coordinator': '05/06', '07-xray-coordinator': '07', '08-otel-coordinator': '08', '10-otel-mode2-coordinator': '10', '11-otel-all-coordinator': '11' })[log.split('dfdemo-')[1]] ?? '?'
const traceStep = { '6ae5cbc4712cf6fd1703fd806783e1ad': '07', '6ae5cc3b44cc9da909fe2c2e7aebf8f3': '08/09', '6ae5cca544a55195411c3a0251cd3b9a': '10', '6ae5cd1c75705e4c04ad9fe673a2a55e': '11' }

function step12() {
  const q1 = qrows('q1-billed-duration-by-function')
  const q3 = qrows('q3-invocations-per-execution')
  const q4 = qrows('q4-spans-per-trace').sort((a, b) => traceStep[a.traceId].localeCompare(traceStep[b.traceId]))
  const q5 = qrows('q5-spans-by-service-and-name').filter((r) => r['attributes.aws.local.service'])
  const q6 = qrows('q6-slowest-spans-step11')
  const svcByTrace = {}
  for (const r of q5) (svcByTrace[r.traceId] ??= []).push(`${r['attributes.aws.local.service']} (${r.spans})`)
  const section = (title, name, body) => `<h4>${esc(title)}</h4>${code(qtext(name), `src/steps/${Q}/queries/${name}.logsinsights`)}${body}<p class="note">Result file: <code>src/steps/${Q}/results/${name}.json</code></p>`
  return `
<p>Queries were run with the <code>otel-playground</code> profile in eu-central-1 against the log groups of the coordinators of steps 05, 07, 08, 10 and 11, and against <code>aws/spans</code> (Transaction Search). Runner: <code>src/steps/${Q}/run.sh</code>. Time window 2026-10-31 10:00 to 12:30 UTC.</p>
${section('Q1. Billed duration per coordinator (Logs Insights)', 'q1-billed-duration-by-function', table(q1, [
    { h: 'Step', f: (r) => stepOfFn(r['@log']) }, { h: 'Log group', f: (r) => r['@log'].split(':').pop() }, { h: 'Handler invocations', k: 'invocations' },
    { h: 'Billed ms (sum)', k: 'billedMs' }, { h: 'Avg duration ms', f: (r) => Number(r.avgDurationMs).toFixed(0) }, { h: 'Max memory MB', k: 'maxMemMB' }]))}
<p>Each coordinator is invoked repeatedly because the execution suspends while specialists run, then replays. Steps 05 and 06 share a log group, so its row covers two executions.</p>
${section('Q2. Workflow milestones logged by context.logger', 'q2-workflow-milestones', table(qrows('q2-workflow-milestones').map((r) => ({ ...r, who: r['@log'].split(':').pop().replace('/aws/lambda/', ''), exec: execShort(r.executionArn).split(' / ')[1].slice(0, 8) })), [
    { h: 'Timestamp (UTC)', k: '@timestamp' }, { h: 'Function', k: 'who' }, { h: 'Execution ID (first 8)', k: 'exec' }, { h: 'Message', f: (r) => r.message }]))}
${section('Q3. Handler invocations per durable execution', 'q3-invocations-per-execution', table(q3.map((r) => ({ ...r, fn: r.executionArn.split(':function:')[1].split(':')[0], id: r.executionArn.split('/').pop() })), [
    { h: 'Function', k: 'fn' }, { h: 'Durable execution ID', k: 'id' }, { h: 'Log lines', k: 'logLines' }, { h: 'Invocations that logged', k: 'invocationsThatLogged' }, { h: 'First seen', k: 'firstSeen' }, { h: 'Last seen', k: 'lastSeen' }]))}
<p>The logger is replay-aware, so replayed code stays silent. Every run logs from two invocations: the one that planned and started the specialists, and the one that resumed after them.</p>
${section('Q4. Spans per trace (Transaction Search, aws/spans)', 'q4-spans-per-trace', table(q4, [
    { h: 'Step', f: (r) => traceStep[r.traceId] }, { h: 'Trace ID', k: 'traceId' }, { h: 'Records', k: 'spans' }, { h: 'Distinct spans', k: 'distinctSpans' },
    { h: 'Trace length (s)', f: (r) => ((Number(r.lastEndNs) - Number(r.firstStartNs)) / 1e9).toFixed(1) }]))}
<p>Records exceed distinct spans because Transaction Search stores some spans more than once (for example an OTel span and its X-Ray segment copy). The console reports the distinct counts used in the screenshots (47, 52, 94 for steps 07, 08, 11 in the console view).</p>
${section('Q5. Services per trace: context propagation', 'q5-spans-by-service-and-name', `<table><thead><tr><th>Step</th><th>Trace ID</th><th>Services (span records)</th></tr></thead><tbody>${q4.map((r) => `<tr><td>${traceStep[r.traceId]}</td><td><code>${r.traceId}</code></td><td>${esc((svcByTrace[r.traceId] ?? []).join(', '))}</td></tr>`).join('')}</tbody></table>`)}
<p>Step 10 shows only the coordinator service: its specialists (the step 08 functions) are untraced, so they cannot join the trace. Steps 07 and 11 show the coordinator and all five specialists in one trace.</p>
${section('Q6. Ten slowest spans of the step 11 trace', 'q6-slowest-spans-step11', table(q6, [
    { h: 'Span name', k: 'name' }, { h: 'Kind', k: 'kind' }, { h: 'Service', f: (r) => r['attributes.aws.local.service'] ?? '' }, { h: 'Duration ms', f: (r) => Number(r.durationMs).toFixed(0) }]))}
<p>The Risk specialist (Sonnet 4.6) dominates: its Bedrock ConverseStream call lasts about 43.5 s, which sets the length of the parallel block.</p>`
}

// ---------------------------------------------------------------- render
function renderStep(s) {
  const f = s.noInvoke ? facts('08-otel') : facts(s.dir)
  const toc = `${s.n}`
  const shots = s.shots.map(([file, cap]) => img(file, cap)).join('\n')
  return `
<section class="step" id="step-${toc}">
  <header><span class="num">${s.n}</span><div><div class="grp">${esc(s.group)}</div><h2>${esc(s.title)}</h2></div></header>
  <div class="grid2">
    <div><h3>Outline bullet</h3><p class="outline">${esc(s.outline)}</p></div>
    <div><h3>Goal</h3><p>${esc(s.goal)}</p></div>
  </div>
  ${s.noInvoke ? `<div class="callout">No function of its own. Evidence below is the step 08 run (function <code>${esc(f.fn)}</code>).</div>` : ''}
  <h3>What to say</h3>
  <ul class="say">${s.say.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
  <h3>Code excerpt (final code)</h3>
  ${code(s.code(), s.codeFile)}
  ${s.extra2 ? s.extra2() : ''}
  <h3>Invocation</h3>
  <table class="ids">
    <tr><th>Function</th><td><code>${esc(f.fn)}</code></td></tr>
    <tr><th>Request ID (x-amzn-RequestId)</th><td><code>${esc(f.requestId)}</code></td></tr>
    <tr><th>Durable execution ID</th><td><code>${esc(f.execId)}</code></td></tr>
    <tr><th>Durable execution ARN</th><td><code>${esc(f.arn)}</code></td></tr>
    <tr><th>Status</th><td>${esc(f.status)}</td></tr>
    <tr><th>Started / ended</th><td><code>${esc(f.started)}</code> / <code>${esc(f.ended)}</code> (${f.wallSeconds} s wall clock)</td></tr>
  </table>
  <div class="grid2">
    ${code(f.request, `Request (src/steps/${s.dir}/request.json)`)}
    ${code(f.response, `Response (artifacts/response.json)`)}
  </div>
  ${code(f.result, 'Execution result (get-durable-execution, long text shortened)')}
  ${s.extra(f)}
  <h3>Screenshots</h3>
  <div class="shots">${shots}</div>
  <h3>Prompt that would generate this</h3>
  <div class="prompt"><button class="copy" type="button">Copy</button><pre>${esc(s.prompt)}</pre></div>
</section>`
}

const tocItems = [...steps.map((s) => [`step-${s.n}`, `${s.n} ${s.title}`]), ['step-12', '12 Run analysis'], ['footnotes', 'Footnotes']]
let currentGroup = ''
const stepHtml = steps.map((s) => {
  let g = ''
  if (s.group !== currentGroup) { currentGroup = s.group; g = `<h1 class="group">${esc(s.group)}</h1>` }
  return g + renderStep(s)
})

const step12Html = `
<section class="step" id="step-12">
  <header><span class="num">12</span><div><div class="grp">Running it at scale!</div><h2>Run analysis</h2></div></header>
  <div class="grid2">
    <div><h3>Outline bullet</h3><p class="outline">Run analysis.</p></div>
    <div><h3>Goal</h3><p>Answer questions about the runs of steps 05 to 11 with CloudWatch Logs Insights (application logs and Lambda platform reports) and with trace queries over the <code>aws/spans</code> log group (Transaction Search). No function; no new invocation.</p></div>
  </div>
  <h3>What to say</h3>
  <ul class="say">
    <li>Logs Insights reads the structured Lambda logs: billed duration per function, workflow milestones and invocations per execution.</li>
    <li>Transaction Search stores spans in aws/spans, so the same query language works on traces: spans per trace, services per trace, slowest spans.</li>
    <li>Q5 is the proof of context propagation: step 11 has all six services in one trace, step 10 only the coordinator.</li>
    <li>Q6 shows where the time goes: the Risk specialist's Bedrock call.</li>
  </ul>
  ${step12()}
  <h3>Prompt that would generate this</h3>
  <div class="prompt"><button class="copy" type="button">Copy</button><pre>${esc(`Using the otel-playground AWS profile in eu-central-1, write and run CloudWatch Logs Insights queries over the runs of steps 05 to 11 of this repo and save query text and JSON results under src/steps/12-analysis/artifacts/{queries,results}.
Log groups for Q1 to Q3: /aws/lambda/dfdemo-05-coordinator, dfdemo-07-xray-coordinator, dfdemo-08-otel-coordinator, dfdemo-10-otel-mode2-coordinator, dfdemo-11-otel-all-coordinator. Log group for Q4 to Q6: aws/spans.
Q1: filter type = "platform.report" | stats count(), sum(record.metrics.billedDurationMs), avg(record.metrics.durationMs), max(record.metrics.maxMemoryUsedMB) by @log.
Q2: filter message like /plan_created|specialists_completed|recommendation_generated|request_completed/ | fields @timestamp, @log, requestId, executionArn, message | sort @timestamp asc.
Q3: filter ispresent(executionArn) | stats count(), count_distinct(requestId), min(@timestamp), max(@timestamp) by executionArn.
Q4: spans per trace for the trace IDs in src/steps/{07-xray,08-otel,10-mode,11-all}/artifacts/trace-ids.txt (dashes removed from the X-Ray ID): count(), count_distinct(spanId), min(startTimeUnixNano), max(endTimeUnixNano) by traceId.
Q5: count by traceId, attributes.aws.local.service for the same traces. Q6: ten slowest spans of the step 11 trace by (endTimeUnixNano - startTimeUnixNano)/1000000.
Write run.sh that starts a query, polls get-query-results until Complete and saves the JSON. Spans can take minutes to appear: retry until rows are returned.`)}</pre></div>
</section>`

const footnotes = `
<section class="step" id="footnotes">
  <header><span class="num">i</span><div><h2>Footnotes</h2></div></header>
  <h3>An earlier failed attempt of step 01</h3>
  <p>The first attempt to run step 01 failed at start-up with <code>createRequire has already been declared</code>. The esbuild banner declared <code>createRequire</code> and the bundled durable SDK declared it as well. Commit <code>4ea687f</code> (<em>fix(build): alias banner createRequire to avoid duplicate declaration with durable SDK bundle</em>) aliases the banner import as <code>__bannerCreateRequire</code>; you can see it in every <code>Banner</code> entry in <code>template.yaml</code>. The logs of that attempt are kept in <code>src/steps/01-retry/artifacts-failed-attempt/</code> and are <strong>not</strong> evidence for step 01: all evidence above comes from the later successful run.</p>
  <p>A later fix, commit <code>f2dce20</code>, changed the REPORT capture in <code>scripts/lib/invoke-step.sh</code>: functions use JSON log format, so there is no plain-text <code>REPORT RequestId</code> line, and <code>report.txt</code> renders the <code>platform.report</code> records in REPORT form.</p>
  <h3>Other notes</h3>
  <ul>
    <li>Models: coordinator <code>global.anthropic.claude-sonnet-4-6</code>, specialists <code>global.anthropic.claude-haiku-4-5-20251001-v1:0</code> (risk assessment uses Sonnet). Newer models were not available in the account.</li>
    <li>Step 03 deviates from the outline text: instead of a callback wait it uses a failing second model call. The handler runs twice (one failed attempt), not three times.</li>
    <li>Step 08 ("X-Ray off" in the outline) keeps <code>Tracing: Active</code> on the coordinator in the template, together with the ADOT layer and the AWSXRayDaemonWriteAccess policy; the OTel plugin adds the durable operation spans.</li>
    <li>Screenshots were taken from the AWS console after federated sign-in; no credentials or sign-in URLs are stored. Image index: <code>report/img/INDEX.md</code>.</li>
    <li>The stack <code>dfdemo</code> was not deleted.</li>
  </ul>
</section>`

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AWS Lambda Durable Functions: step-by-step presentation guide</title>
<style>
:root{--bg:#f6f7f9;--fg:#1b2330;--mut:#5b6678;--card:#fff;--acc:#0b5fff;--line:#dde2ea;--code:#0f1724;--codefg:#e6edf6}
*{box-sizing:border-box}body{margin:0;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
nav{position:fixed;inset:0 auto 0 0;width:300px;overflow:auto;background:#101826;color:#cbd5e4;padding:20px 16px}
nav h1{font-size:15px;color:#fff;margin:0 0 12px}nav a{display:block;color:#cbd5e4;text-decoration:none;font-size:13px;padding:5px 8px;border-radius:6px}nav a:hover{background:#1c2940;color:#fff}
main{margin-left:300px;padding:32px 40px;max-width:1280px}
h1.group{font-size:28px;margin:48px 0 8px;border-bottom:3px solid var(--acc);padding-bottom:6px}
.step{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px 28px;margin:20px 0}
.step>header{display:flex;gap:16px;align-items:center;margin-bottom:12px}.num{background:var(--acc);color:#fff;border-radius:10px;min-width:48px;height:48px;display:grid;place-items:center;font-weight:700;font-size:20px}
.grp{color:var(--mut);font-size:13px;text-transform:uppercase;letter-spacing:.05em}h2{margin:0;font-size:22px}h3{margin:22px 0 6px;font-size:15px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}h4,h5,h6{margin:18px 0 6px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:1000px){nav{display:none}main{margin:0;padding:16px}.grid2{grid-template-columns:1fr}}
.outline{font-style:italic;border-left:4px solid var(--acc);padding-left:12px}
.say li{margin:4px 0}.code{margin:10px 0;border-radius:8px;overflow:hidden;background:var(--code)}.code .label{background:#1d2a40;color:#9fb3cf;font:12px ui-monospace,monospace;padding:5px 12px}
pre{margin:0;padding:12px;overflow:auto;color:var(--codefg);font:12.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word}
code{font-family:ui-monospace,Menlo,monospace;font-size:.9em;word-break:break-all}p code,td code,li code{background:#eef1f6;border-radius:4px;padding:1px 4px}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:14px}th,td{border:1px solid var(--line);padding:6px 9px;text-align:left;vertical-align:top}th{background:#f0f3f8}
table.ids th{width:230px}.callout{background:#fff7e0;border:1px solid #f0d58a;border-radius:8px;padding:10px 14px;margin:12px 0}.note{color:var(--mut);font-size:14px}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:14px}figure{margin:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fff}figure img{width:100%;display:block}figcaption{font-size:13px;color:var(--mut);padding:6px 10px}
.prompt{position:relative;background:#eef4ff;border:1px solid #bcd0ff;border-radius:8px}.prompt pre{color:#10213f;font:13px/1.5 ui-monospace,Menlo,monospace}.copy{position:absolute;right:8px;top:8px;border:0;background:var(--acc);color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer}
.evidence{border:1px solid var(--line);border-radius:8px;padding:4px 16px;background:#fbfcfe}
.cover{background:linear-gradient(135deg,#0b5fff,#6a3df0);color:#fff;border-radius:14px;padding:32px 36px}.cover h1{margin:0 0 8px;font-size:32px}.cover p{margin:4px 0;opacity:.95}
</style></head><body>
<nav><h1>Durable Functions guide</h1>${tocItems.map(([id, t]) => `<a href="#${id}">${esc(t)}</a>`).join('')}</nav>
<main>
<div class="cover"><h1>AWS Lambda Durable Functions: an orchestrator across LLM calls</h1>
<p>Step-by-step presentation guide. Every request, response, ID and screenshot comes from a real run in stack <code style="background:#ffffff33;color:#fff">dfdemo</code>, region eu-central-1.</p>
<p>Source: <code style="background:#ffffff33;color:#fff">src/steps/NN-*/artifacts/</code>, screenshots in <code style="background:#ffffff33;color:#fff">report/img/</code>. Each step ends with a prompt that reproduces its code.</p></div>
${stepHtml.join('\n')}
${step12Html}
${footnotes}
</main>
<script>
document.querySelectorAll('.copy').forEach(function(b){b.addEventListener('click',function(){
  var t=b.parentElement.querySelector('pre').innerText;
  (navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){b.textContent='Copied'},function(){b.textContent='Select text'});
  setTimeout(function(){b.textContent='Copy'},1500)})});
</script>
</body></html>`

// ---------------------------------------------------------------- safety gate
const forbidden = [/SigninToken/i, /signin\.aws\.amazon\.com\/federation/i, /AKIA[0-9A-Z]{16}/, /ASIA[0-9A-Z]{16}/, /aws_secret_access_key/i, /aws_session_token/i, /X-Amz-Security-Token/i, /AWSReservedSSO/, /\/Users\/rm/]
for (const re of forbidden) if (re.test(html)) throw new Error(`report contains forbidden pattern ${re}`)

writeFileSync(join(ROOT, 'report/index.html'), html)
console.log(`wrote report/index.html (${html.length} bytes)`)
