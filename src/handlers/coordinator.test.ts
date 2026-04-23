import { jest, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "@jest/globals";

/**
 * Durable execution tests for the coordinator handler.
 *
 * Pattern: mock external I/O (Strands Agent, specialist Lambda functions),
 * let LocalDurableTestRunner run the real checkpoint/replay engine. The
 * four-phase flow (plan → parallel specialists → synthesize → optional approval)
 * exercises all four durable primitives plus context.invoke().
 */

import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";

// ---------------------------------------------------------------------------
// Environment — must be set before coordinator module loads
// ---------------------------------------------------------------------------
process.env.COORDINATOR_MODEL_ID = "test-model";
process.env.PRICE_RESEARCH_FUNCTION = "PriceResearchFunction";
process.env.FINANCING_FUNCTION = "FinancingFunction";
process.env.DELIVERY_FUNCTION = "DeliveryFunction";
process.env.RISK_ASSESSMENT_FUNCTION = "RiskAssessmentFunction";
process.env.CONTRACT_REVIEW_FUNCTION = "ContractReviewFunction";

// ---------------------------------------------------------------------------
// Configurable routing — changed per test to simulate different plans
// ---------------------------------------------------------------------------

interface PlannedSpecialist {
  name: string;
  prompt: string;
}

// Default: laptop scenario (price-research + delivery)
let activePlan: PlannedSpecialist[] = [
  { name: "price-research", prompt: "Analyze laptop pricing around $1500" },
  { name: "delivery", prompt: "Plan delivery for a laptop" },
];

// Set to true to simulate the planning agent not calling the tool
let skipPlanTool = false;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock Strands Agent — handles both planning and synthesis invocations.
// Planning invocation: finds create_analysis_plan tool and calls it with activePlan.
// Synthesis invocation: no tools, returns a fixed recommendation.
// Note: @strands-agents/sdk is ESM-only, so we can't use jest.requireActual.
// We provide the minimal exports the coordinator needs: Agent, tool, BedrockModel.
interface MockTool {
  name: string;
  callback: (input: unknown) => Promise<string>;
}

jest.mock("@strands-agents/sdk", () => ({
  Agent: jest.fn().mockImplementation((...args: unknown[]) => {
    const { tools } = args[0] as { tools?: MockTool[] };
    return {
      invoke: jest.fn(async () => {
        if (tools && tools.length > 0) {
          if (!skipPlanTool) {
            const planTool = tools.find((t: MockTool) => t.name === "create_analysis_plan");
            if (planTool) {
              await planTool.callback({ specialists: activePlan });
            }
          }
          return { toString: () => "Plan created." };
        }
        return { toString: () => "Buy the mid-range option for best value." };
      }),
    };
  }),
  BedrockModel: jest.fn().mockImplementation(() => ({})),
  tool: jest.fn().mockImplementation((...args: unknown[]) => args[0] as Record<string, unknown>),
}));

// ---------------------------------------------------------------------------
// Specialist handler mock — used by LocalDurableTestRunner for context.invoke()
// ---------------------------------------------------------------------------

const specialistHandler = async (event: { prompt: string }) => {
  return { response: `Canned specialist analysis for: ${event.prompt.slice(0, 30)}` };
};

// ---------------------------------------------------------------------------
// Import handler AFTER mocks
// ---------------------------------------------------------------------------

import { handler } from "./coordinator.js";

// ---------------------------------------------------------------------------
// Test payloads
// ---------------------------------------------------------------------------

const laptopPayload = {
  request: "I want to buy a laptop for work, around $1500",
  requireApproval: false,
};

const usedCarPayload = {
  request: "I want to buy a used 2020 Honda Civic for around $18,000",
  requireApproval: true,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Coordinator — Durable Execution", () => {
  let runner: LocalDurableTestRunner;

  beforeAll(async () => {
    await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
  });

  afterAll(async () => {
    await LocalDurableTestRunner.teardownTestEnvironment();
  });

  beforeEach(() => {
    // Register specialist handler for context.invoke() calls.
    // All 5 specialist functions use the same mock handler.
    runner = new LocalDurableTestRunner({ handlerFunction: handler });
    runner
      .registerFunction("PriceResearchFunction", specialistHandler)
      .registerFunction("FinancingFunction", specialistHandler)
      .registerFunction("DeliveryFunction", specialistHandler)
      .registerFunction("RiskAssessmentFunction", specialistHandler)
      .registerFunction("ContractReviewFunction", specialistHandler);
    skipPlanTool = false;
    // Default: laptop scenario
    activePlan = [
      { name: "price-research", prompt: "Analyze laptop pricing around $1500" },
      { name: "delivery", prompt: "Plan delivery for a laptop" },
    ];
  });

  afterEach(async () => {
    await runner.reset();
  });

  it("should run plan → parallel specialists → synthesize", async () => {
    const result = runner.run({ payload: laptopPayload });

    const output = await result;
    expect(output.getStatus()).toBe("SUCCEEDED");

    const resultData = output.getResult();
    expect(resultData).toMatchObject({
      status: "completed",
      recommendation: "Buy the mid-range option for best value.",
    });

    // Routing from plan step
    expect(resultData.routing.called).toContain("Price Research");
    expect(resultData.routing.called).toContain("Delivery & Logistics");
    expect(resultData.routing.skipped).toContain("Financing");
  });

  it("should run all 5 specialists in parallel for used car", async () => {
    activePlan = [
      { name: "price-research", prompt: "Analyze used car pricing" },
      { name: "financing", prompt: "Evaluate financing for $18K" },
      { name: "delivery", prompt: "Plan car delivery" },
      { name: "risk-assessment", prompt: "Assess used car risks" },
      { name: "contract-review", prompt: "Review dealer contract" },
    ];

    const result = runner.run({ payload: { ...laptopPayload, requireApproval: false } });

    const output = await result;
    expect(output.getStatus()).toBe("SUCCEEDED");
    expect(output.getResult().routing.called).toHaveLength(5);
    expect(output.getResult().routing.skipped).toHaveLength(0);
  });

  it("should suspend at approval and resume on approve", async () => {
    const result = runner.run({ payload: usedCarPayload });

    const approvalCallback = await runner.getOperation("approval");
    const callbackDetails = await approvalCallback.waitForData();

    // sendCallbackSuccess passes JSON.stringify because the handler uses
    // serdes: defaultSerdes on waitForCallback. Without defaultSerdes, the
    // result would be a raw string and approval.approved would be undefined.
    await callbackDetails.sendCallbackSuccess(
      JSON.stringify({ approved: true, notes: "Looks good, proceed." })
    );

    const output = await result;
    expect(output.getStatus()).toBe("SUCCEEDED");
    expect(output.getResult()).toMatchObject({
      status: "approved",
      recommendation: expect.any(String),
    });
  });

  it("should return rejected when approval is denied", async () => {
    const result = runner.run({ payload: usedCarPayload });

    const approvalCallback = await runner.getOperation("approval");
    const callbackDetails = await approvalCallback.waitForData();

    await callbackDetails.sendCallbackSuccess(
      JSON.stringify({ approved: false, notes: "Price is too high." })
    );

    const output = await result;
    expect(output.getStatus()).toBe("SUCCEEDED");
    expect(output.getResult()).toMatchObject({
      status: "rejected",
      approverNotes: "Price is too high.",
    });
  });

  it("should degrade gracefully when a specialist fails", async () => {
    // Override delivery to throw — price-research should still succeed
    runner.registerFunction("DeliveryFunction", async () => {
      throw new Error("Service unavailable");
    });

    const result = runner.run({ payload: laptopPayload });

    const output = await result;
    expect(output.getStatus()).toBe("SUCCEEDED");

    const resultData = output.getResult();
    expect(resultData.status).toBe("completed");
    // Synthesis still runs with partial results
    expect(resultData.recommendation).toBeDefined();
  });

  it("should fail when approval callback fails", async () => {
    const result = runner.run({ payload: usedCarPayload });

    const approvalCallback = await runner.getOperation("approval");
    const callbackDetails = await approvalCallback.waitForData();

    await callbackDetails.sendCallbackFailure({
      ErrorMessage: "Callback timed out",
      ErrorType: "CallbackTimeout",
    });

    const output = await result;
    expect(output.getStatus()).toBe("FAILED");
  });

  it("should fail when planning agent does not call the tool", async () => {
    // Simulates the planning agent not calling create_analysis_plan.
    // The step throws a regular Error, which the retry strategy will retry
    // (up to maxAttempts), but since the mock consistently skips the tool
    // call, all retries fail and the execution ends as FAILED.
    skipPlanTool = true;

    const result = runner.run({ payload: laptopPayload });

    const output = await result;
    expect(output.getStatus()).toBe("FAILED");
  });
});
