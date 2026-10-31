# Console screenshots (region eu-central-1, account 913524906826, stack dfdemo)

Taken 2026-10-31 from the AWS console. Execution IDs are in `src/steps/NN-*/artifacts/durable-execution-id.txt`.

| File | Step | Shows |
|---|---|---|
| 00-cloudformation-dfdemo.png | all | CloudFormation stack `dfdemo`, UPDATE_COMPLETE, stack info |
| 00-console-check.png | preflight | Earlier console login check |
| NN-lambda-function.png | 01-08, 10, 11 | Lambda function page (overview, ARN, type Durable) of the step's function |
| NN-durable-executions.png | 01-08, 10, 11 | Durable executions tab with the recorded execution (ID, Succeeded, start/end, duration) |
| 06-lambda-function.png, 06-durable-executions.png | 06 | Same function as 05 (`dfdemo-05-coordinator`); the 06 run is the 2f16e5b3... row |
| 01..04-cloudwatch-logs.png | 01-04 | CloudWatch log events of the latest log stream of the function's log group |
| 05, 07, 08, 10, 11-cloudwatch-logs.png | coordinators | Log events of the coordinator's latest log stream (05 shares the group with 06) |
| 07-trace-detail.png | 07 | X-Ray/CloudWatch trace 1-6ae5cbc4-712cf6fd1703fd806783e1ad: 47 spans, segments graph, Durable Execution Attempt spans |
| 08-trace-detail.png | 08, 09 | OTel trace 1-6ae5cc3b-44cc9da909fe2c2e7aebf8f3: 52 spans, Bedrock node |
| 10-trace-detail.png | 10 | Trace 1-6ae5cca5-44a55195411c3a0251cd3b9a (mode 2 coordinator) |
| 11-trace-detail.png | 11 | Trace 1-6ae5cd1c-75705e4c04ad9fe673a2a55e: 94 spans, context propagation |
| 07-11-trace-map-all.png | 07-11 | CloudWatch Trace Map (last 3h) with the 07 X-Ray nodes and the 10/11 OTel nodes |

Step 09 uses 08-trace-detail.png (same run). Step 12 has no function and no screenshot.
