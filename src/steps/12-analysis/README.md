# Step 12: run analysis (mainly on spans)

No function. The analysis runs CloudWatch Logs Insights queries over the
`aws/spans` log group (CloudWatch Transaction Search) for the four traces of the
tracing steps 07, 08/09, 10 and 11. Trace IDs are in each step's
`artifacts/trace-ids.txt`.

| Query | Question |
|---|---|
| s1-span-inventory | What does each tracing option record? |
| s2-invocations-by-function | Which functions end up in one trace (context propagation)? |
| s3-span-names | Which operations get a span of their own? |
| s4-bedrock-calls | Model calls as spans: calls, tokens, latency |
| s5-durable-overhead | Checkpoint calls, dwell time and attempts as spans |
| s6-lambda-init | Cold starts as Init spans |
| s7-slowest-spans-step11 | The longest spans of the step 11 trace |
| s8-parallel-specialists-step11 | Do the specialists run in parallel? |
| l1-l3 | Complement: Lambda logs (billed duration, workflow milestones, invocations per execution) |

Transaction Search can hold two records of one span (an OTel span and its X-Ray
segment copy), and `dedup` cannot come before `stats`. The span queries
therefore group by `spanId` in a first `stats` and aggregate in a second one.

Run a query: `artifacts/run.sh <query-file> <start-epoch> <end-epoch> <log-group>...`
with the window 2026-10-31 10:00 to 12:30 UTC (1793440800 to 1793449800).
Queries are in `artifacts/queries/`, results in `artifacts/results/`.
