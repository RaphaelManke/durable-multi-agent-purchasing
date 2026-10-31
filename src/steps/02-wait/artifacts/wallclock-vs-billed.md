# Wall-clock time versus billed duration (step 02, execution cebba598-2afa-4225-804a-ed24d64c411e)

- Wall clock: ExecutionStarted 2026-10-31T11:58:44.934+01:00 to ExecutionSucceeded 11:59:46.291+01:00 = 61.357 s (includes the 60 s `cooldown` wait).
- Billed: three handler invocations, 71 ms + 67 ms + 41 ms = 179 ms (see report.txt).
- Between the second InvocationCompleted (11:58:46.200) and the next invocation (11:59:46.264) no function was running, so the 60 s wait added 0 ms of billed duration.
- Durations come from the platform.report log records (the function uses JSON log format, so there is no plain-text "REPORT RequestId" line; report.txt renders the same fields in REPORT form).
