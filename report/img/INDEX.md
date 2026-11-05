# Console screenshots (region eu-central-1, account 913524906826, stack dfdemo)

Taken 2026-10-31 from the AWS console. Execution IDs are in `src/steps/NN-*/artifacts/durable-execution-id.txt`.

| File | Step | Shows |
|---|---|---|
| 00-cloudformation-dfdemo.png | all | CloudFormation stack `dfdemo`, UPDATE_COMPLETE, stack info |
| 00-console-check.png | preflight | Earlier console login check |
| NN-durable-executions.png | 01-08, 10, 11 | Durable executions tab with the recorded execution (ID, Succeeded, start/end, duration) |
| 06-durable-executions.png | 06 | Same function as 05 (`dfdemo-05-coordinator`); the 06 run is the 2f16e5b3... row |
| 01..04-cloudwatch-logs.png | 01-04 | CloudWatch log events of the latest log stream of the function's log group |
| 05, 07, 08, 10, 11-cloudwatch-logs.png | coordinators | Log events of the coordinator's latest log stream (05 shares the group with 06) |
| 07-11-trace-map-all.png | 07-11 | CloudWatch Trace Map (last 3h) with the 07 X-Ray nodes and the 10/11 OTel nodes |

Step 09 uses the step 08 trace images (same run). Step 12 has no function and no screenshot.

## Durable execution drill-down (scripts/exec-screenshots.sh)

Lambda console, durable execution detail page of each step's recorded run (steps 01-08, 10, 11).

| File | Shows |
|---|---|
| NN-exec-operations.png | Durable operations table with every nested operation expanded (parallel branches and their chained invokes), plus the timeline per operation |
| NN-exec-io.png | Input/Output tab (request and result of the durable execution) |
| NN-exec-events-pK.png | Page and header of the execution with the full event history, every event expanded to its JSON. Executions with more than 25 events are split into pages of 25 events (steps 06, 07, 08, 10, 11 have 34 events, so p1 and p2) |

The console's "Logger output" tab is not captured: it only shows output written through the durable SDK logger, and these handlers log with console.log, so it is empty.

The Lambda function page (`NN-lambda-function.png`, which only showed the bundled handler code) was removed as not useful.

## Trace map and timeline (scripts/trace-screenshots.sh)

CloudWatch console, trace page of each tracing step's run. The page shows the trace ID, duration and span count above each image.

| File | Shows |
|---|---|
| 07-trace-map.png, 08-trace-map.png, 10-trace-map.png, 11-trace-map.png | The trace graph in full screen: client, coordinator, specialists and (OTel) the Bedrock node |
| 07-trace-timeline.png, 08-trace-timeline.png, 10-trace-timeline.png, 11-trace-timeline.png | The span timeline waterfall of the whole trace (47, 52, 52 and 94 spans) |

Step 09 reuses the step 08 images (same run).
