import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./handler.js";

describe("Step 01 — retry", () => {
  beforeAll(async () => {
    await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
  });

  afterAll(async () => {
    await LocalDurableTestRunner.teardownTestEnvironment();
  });

  it("retries the flaky step once and succeeds on attempt 2", async () => {
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const output = await runner.run({ payload: { name: "test" } });

    expect(output.getStatus()).toBe("SUCCEEDED");
    expect(output.getResult()).toMatchObject({
      status: "completed",
      greeting: "Hello, test",
      succeededOnAttempt: 2,
    });
    await runner.reset();
  });
});
