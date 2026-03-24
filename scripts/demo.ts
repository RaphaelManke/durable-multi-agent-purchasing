#!/usr/bin/env npx tsx

import * as readline from "node:readline/promises";
import { execSync } from "node:child_process";
import { stdin, stdout } from "node:process";

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PurchaseScenario {
  request: string;
  specialists: string[];
  skipped: string[];
  mockResponses: Record<string, string>;
  mockRecommendation: string;
}

interface ApprovalPayload {
  approved: boolean;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Purchase scenarios
// ---------------------------------------------------------------------------

const SCENARIOS: Record<string, PurchaseScenario> = {
  laptop: {
    request: "I want to buy a 15-inch laptop for software development, budget around $1,500",
    specialists: ["price-research", "delivery"],
    skipped: ["financing", "risk-assessment", "contract-review"],
    mockResponses: {
      "price-research":
        "Budget range: $800–$2,500. At $1,500 you're in the mid-range sweet spot — expect a current-gen CPU (i7/Ryzen 7), 16–32GB RAM, 512GB–1TB SSD, and a solid display. The Dell XPS 15, Lenovo ThinkPad T series, and MacBook Pro 15\" are the main contenders at this tier. Prices are stable; no major sales expected until Black Friday.",
      delivery:
        "Standard shipping: 3–5 business days, free from most retailers. Expedited: 1–2 days, $15–30. Ship in original packaging — no special handling needed. Inspect for dead pixels and keyboard flex on arrival. Keep original box for 30 days in case of return.",
    },
    mockRecommendation:
      "For a $1,500 development laptop, the mid-range tier offers excellent value. You'll get current-gen processors with 16–32GB RAM. Standard delivery is free from major retailers with 3–5 day shipping. No financing, risk assessment, or contract review needed for this straightforward retail purchase. Recommend comparing the top 3 options at your local electronics store before ordering online for the best price.",
  },
  "used-car": {
    request: "I want to buy a used 2020 Honda Civic for around $18,000",
    specialists: ["price-research", "financing", "delivery", "risk-assessment", "contract-review"],
    skipped: [],
    mockResponses: {
      "price-research":
        "2020 Honda Civic market range: $15,000–$22,000 depending on trim, mileage, and condition. At $18,000 you're targeting a mid-mileage EX or Sport trim with 40–60K miles. Private sellers run $1,000–$2,000 below dealer prices but with less recourse. Prices have stabilized after the post-pandemic surge.",
      financing:
        "Typical used car rates: 5.5–8.5% APR for 36–60 months depending on credit. At $18,000 with $3,000 down, a 48-month loan at 6.5% = ~$356/month, total cost $20,100. Credit unions typically beat dealer financing by 1–2%. Get pre-approved before negotiating.",
      delivery:
        "For a used car: inspect in person before purchase. If buying remote, budget $500–$1,200 for enclosed transport depending on distance. Open transport is $300–$800 but exposes the vehicle. Allow 7–14 days for delivery. Verify VIN matches title on arrival.",
      "risk-assessment":
        "Key risks for a used 2020 Civic: hidden accident history (pull Carfax/AutoCheck), deferred maintenance (request service records), title issues (verify clean title, no liens). The 2020 Civic has no major recalls. Budget $500–$800 for a pre-purchase inspection. Total cost of ownership: ~$4,000–$5,000/year including insurance, maintenance, and fuel. Walk away if: salvage title, inconsistent mileage, seller won't allow inspection.",
      "contract-review":
        "Key terms to review: warranty coverage (if CPO), as-is disclosure, arbitration clauses, gap insurance options. Dealer contracts: watch for extended warranty upsells, paint protection, and VIN etching add-ons — all negotiable or declinable. Private sale: use a bill of sale template, verify lien release, and confirm title transfer at DMV together.",
    },
    mockRecommendation:
      "This used 2020 Honda Civic purchase at $18,000 is well-positioned in the market. All five specialists were consulted given the value ($18K), used condition, and physical delivery requirements.\n\nKey findings:\n- Price is fair for a mid-mileage EX/Sport trim ($15K–$22K range)\n- Financing at ~6.5% APR over 48 months = ~$356/month — get pre-approved at a credit union\n- Budget $500–$1,200 for transport if buying remotely\n- Get a pre-purchase inspection ($500–$800) — non-negotiable for used vehicles\n- Review dealer contract for add-on upsells; decline paint protection and VIN etching\n\nRecommendation: Proceed with purchase after pre-purchase inspection and Carfax verification. Get pre-approved financing before negotiating price.",
  },
  saas: {
    request: "We're evaluating a project management SaaS tool at $200/month for our 25-person team",
    specialists: ["price-research", "contract-review"],
    skipped: ["financing", "delivery", "risk-assessment"],
    mockResponses: {
      "price-research":
        "Project management SaaS pricing: $5–$25/user/month is typical. At $200/month for 25 users ($8/user), you're in the budget-to-mid tier. Comparable options: Asana ($10.99/user), Monday.com ($9/user), Jira ($7.75/user), ClickUp ($7/user). Annual billing typically saves 15–20%. Negotiate for volume discounts above 20 seats.",
      "contract-review":
        "Key SaaS contract terms: look for annual vs. monthly commitment (monthly = flexibility, annual = savings), auto-renewal clauses (require 30-day notice minimum), data export provisions (ensure you can export all data in standard format), SLA guarantees (99.9% uptime minimum), and cancellation terms (pro-rated refund or locked in). Watch for: seat minimums that ratchet up, price escalation clauses, and data retention limits after cancellation.",
    },
    mockRecommendation:
      "The $200/month ($8/user) pricing is competitive for the project management SaaS category. Two specialists were consulted — no financing, delivery, or risk assessment needed for a standard SaaS subscription.\n\nKey findings:\n- Pricing is at the budget-to-mid tier; comparable tools range $7–$11/user\n- Negotiate annual billing for 15–20% savings (~$2,000–$2,400/year vs $2,400)\n- Contract priorities: avoid auto-renewal lock-in, ensure data export rights, and verify 99.9% SLA\n\nRecommendation: Request a trial, negotiate annual pricing with data export guarantees, and ensure 30-day cancellation notice terms.",
  },
};

const SPECIALIST_DISPLAY: Record<string, string> = {
  "price-research": "Price Research",
  financing: "Financing",
  delivery: "Delivery & Logistics",
  "risk-assessment": "Risk Assessment",
  "contract-review": "Contract Review",
};

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

const RULE = "─".repeat(60);
const HEAVY_RULE = "═".repeat(60);

function printHeader(): void {
  console.log();
  console.log(c.bold("  Multi-Agent Purchasing Coordinator — Interactive Demo"));
  console.log(c.dim("  AWS Lambda Durable Functions + Strands Agents SDK"));
  console.log();
}

function printRequest(request: string): void {
  console.log(`  ${c.cyan(RULE)}`);
  console.log(`  ${c.cyan("Purchase Request")}`);
  console.log();
  wrapText(request, 56).forEach((line) => console.log(`  ${line}`));
  console.log(`  ${c.cyan(RULE)}`);
  console.log();
}

function printStep(name: string, detail?: string): void {
  console.log(`  ${c.blue("▶")} ${c.bold(`step: ${name}`)}`);
  if (detail) console.log(`    ${c.dim(detail)}`);
}

function printSuspend(name: string): void {
  console.log(`  ${c.yellow("⏸")} ${c.bold(`waitForCallback: ${name}`)}`);
  console.log(`    ${c.yellow("Function suspended. Compute charges stopped.")}`);
  console.log();
}

function printResume(name: string): void {
  console.log(`    ${c.green("✓")} ${c.bold(`Callback received: ${name}. Function resumed.`)}`);
  console.log();
}

function printCheckpoint(name: string, durationMs: number): void {
  console.log(`    ${c.green("✓")} ${c.dim(`Checkpointed ${name} (${durationMs}ms)`)}`);
}

function printParallel(name: string, branches: string[]): void {
  console.log(`  ${c.blue("▶")} ${c.bold(`parallel: ${name}`)}`);
  for (let i = 0; i < branches.length; i++) {
    const prefix = i < branches.length - 1 ? "├─" : "└─";
    console.log(`    ${prefix} ${c.green("✓")} ${branches[i]}`);
  }
  console.log();
}

function printSpecialistResult(name: string, response: string): void {
  console.log(`  ${c.cyan(RULE)}`);
  console.log(`  ${c.cyan(SPECIALIST_DISPLAY[name] ?? name)} Response`);
  console.log();
  wrapText(response, 56).forEach((line) => console.log(`  ${line}`));
  console.log(`  ${c.cyan(RULE)}`);
  console.log();
}

function printRouting(called: string[], skipped: string[]): void {
  console.log(`  ${c.blue("▶")} ${c.bold("step: routing-summary")}`);
  console.log(`    ${c.green("Called:")}  ${called.map((s) => SPECIALIST_DISPLAY[s] ?? s).join(", ") || "(none)"}`);
  console.log(`    ${c.dim("Skipped:")} ${skipped.map((s) => SPECIALIST_DISPLAY[s] ?? s).join(", ") || "(none)"}`);
  console.log();
}

function printResult(result: { status: string; recommendation: string; routing?: { called: string[]; skipped: string[] } }): void {
  console.log();
  console.log(`  ${c.bold(HEAVY_RULE)}`);
  console.log(`  ${c.bold("RESULT")}`);
  console.log();
  const statusColor = result.status === "completed" || result.status === "approved" ? c.green : c.red;
  console.log(`  ${c.dim("Status:")} ${statusColor(result.status)}`);
  if (result.recommendation) {
    console.log();
    console.log(`  ${c.dim("Recommendation:")}`);
    wrapText(result.recommendation, 56).forEach((line) => console.log(`  ${line}`));
  }
  console.log(`  ${c.bold(HEAVY_RULE)}`);
  console.log();
}

function printRoleHeader(role: string): void {
  console.log(`  ${c.magenta(HEAVY_RULE)}`);
  console.log(`  ${c.magenta(c.bold(role))}`);
  console.log(`  ${c.magenta(HEAVY_RULE)}`);
  console.log();
}

function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    const words = paragraph.split(" ");
    let current = "";
    for (const word of words) {
      if (current.length + word.length + 1 > width) {
        lines.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function askYesNo(rl: readline.Interface, question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = await rl.question(`  ${c.yellow("?")} ${question} (${hint}) `);
  if (!answer.trim()) return defaultYes;
  return answer.trim().toLowerCase().startsWith("y");
}

async function askChoice(rl: readline.Interface, prompt: string, options: string[]): Promise<number> {
  console.log(`  ${prompt}`);
  options.forEach((opt, i) => console.log(`    ${c.bold(`${i + 1}.`)} ${opt}`));
  console.log();
  const answer = await rl.question(`  ${c.yellow(">")} `);
  const choice = parseInt(answer.trim(), 10);
  if (choice >= 1 && choice <= options.length) return choice - 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Local mode — mocked responses, simulated durable execution flow
// ---------------------------------------------------------------------------

async function runLocal(
  scenario: string,
  data: PurchaseScenario,
  rl: readline.Interface
): Promise<void> {
  console.log(`  ${c.dim(`Mode: local (mocked) | Scenario: ${scenario}`)}`);
  console.log();

  // Show request
  console.log(`  ${c.blue("▶")} ${c.bold("Purchase request received")}`);
  printRequest(data.request);

  // Phase 1: Plan
  printStep("plan", "Agent analyzing purchase and selecting specialists...");
  await sleep(1500);
  printRouting(data.specialists, data.skipped);
  printCheckpoint("plan", 1340);
  console.log();

  // Phase 2: Parallel specialists
  printParallel("specialists", data.specialists.map((s) => {
    const display = SPECIALIST_DISPLAY[s] ?? s;
    return `${display}: Consulting...`;
  }));

  // Show individual specialist results as they "complete"
  for (const specialist of data.specialists) {
    await sleep(800);
    printSpecialistResult(specialist, data.mockResponses[specialist]);
  }

  // Phase 3: Synthesize
  printStep("synthesize", "Agent synthesizing specialist findings...");
  await sleep(1200);
  printCheckpoint("synthesize", 980);
  console.log();

  // Approval callback (only for high-value scenarios)
  const needsApproval = scenario === "used-car" || scenario === "saas";
  let approved = true;

  if (needsApproval) {
    printSuspend("approval");
    printRoleHeader("YOU ARE THE PURCHASE APPROVER");

    console.log(`  ${c.dim("Recommendation:")}`);
    wrapText(data.mockRecommendation, 56).forEach((line) => console.log(`  ${line}`));
    console.log();

    approved = await askYesNo(rl, "Approve this purchase recommendation?");
    let notes = "";
    if (approved) {
      notes = await rl.question(`  ${c.yellow(">")} Approval notes (optional): `);
    } else {
      notes = await rl.question(`  ${c.yellow(">")} Rejection reason: `);
    }
    void notes;

    console.log();
    printResume("approval");
  }

  if (!approved) {
    console.log(`  ${c.red("▶")} ${c.bold("Purchase rejected. Workflow ending.")}`);
    printResult({ status: "rejected", recommendation: "" });
    return;
  }

  // Save recommendation
  printStep("save-recommendation", "Saving recommendation...");
  await sleep(300);
  printCheckpoint("save-recommendation", 18);
  console.log();

  // Result
  printResult({
    status: needsApproval ? "approved" : "completed",
    recommendation: data.mockRecommendation,
    routing: { called: data.specialists, skipped: data.skipped },
  });
}

// ---------------------------------------------------------------------------
// Cloud mode — real Lambda invocation with polling
// ---------------------------------------------------------------------------

const awsFlags: string[] = [];
let cloudFunctionArn: string | undefined;

function cli(command: string): string {
  const fullCommand = command.startsWith("aws ")
    ? `${command} ${awsFlags.join(" ")}`
    : command;
  try {
    return execSync(fullCommand, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    throw new Error(error.stderr || error.message || "CLI command failed");
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function cliJson<T>(command: string): T {
  return JSON.parse(cli(command)) as T;
}

async function runCloud(
  scenario: string,
  data: PurchaseScenario,
  rl: readline.Interface
): Promise<void> {
  const needsApproval = scenario === "used-car" || scenario === "saas";
  console.log(`  ${c.dim(`Mode: cloud | Scenario: ${scenario} | Approval: ${needsApproval ? "yes" : "no"}`)}`);
  console.log();

  // Resolve function ARN
  const functionArn = cloudFunctionArn;
  if (!functionArn) {
    console.log(`  ${c.red("✗")} No function ARN provided. Use --function-arn=<arn> or deploy first.`);
    return;
  }

  const baseFunctionName = functionArn.split(":").slice(-2, -1)[0] || functionArn;
  const executionName = `demo-${scenario}-${Date.now()}`;

  // Verify function exists
  console.log(`  ${c.blue("▶")} ${c.bold("Checking deployed function...")}`);
  try {
    cli(`aws lambda get-function --function-name ${functionArn} --query 'Configuration.FunctionName' --output text`);
    console.log(`    ${c.green("✓")} ${c.dim("Function found")}`);
  } catch {
    console.log(`    ${c.red("✗")} Function not found. Deploy first: sam build && sam deploy --guided`);
    return;
  }

  // Show request
  console.log();
  console.log(`  ${c.blue("▶")} ${c.bold("Invoking durable execution")}`);
  printRequest(data.request);

  // Invoke
  const payload = { request: data.request, requireApproval: needsApproval };
  try {
    cli(
      `aws lambda invoke --function-name ${functionArn} --invocation-type Event ` +
      `--durable-execution-name "${executionName}" ` +
      `--cli-binary-format raw-in-base64-out ` +
      `--payload ${shellQuote(JSON.stringify(payload))} /dev/null`
    );
    console.log(`    ${c.green("✓")} ${c.dim(`Execution started: ${executionName}`)}`);
  } catch (err) {
    console.log(`    ${c.red("✗")} Invocation failed: ${(err as Error).message}`);
    return;
  }

  // Find execution ARN
  const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const isTTY = process.stdout.isTTY;
  if (isTTY) {
    process.stdout.write(`    ${c.dim("Finding execution ARN...")} `);
  } else {
    console.log(`    ${c.dim("Finding execution ARN...")}`);
  }
  await sleep(2000);

  let executionArn = "";
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const result = cliJson<{ DurableExecutions?: Array<{ DurableExecutionArn: string; DurableExecutionName: string }> }>(
        `aws lambda list-durable-executions-by-function --function-name ${baseFunctionName} --output json`
      );
      const execution = result.DurableExecutions?.find((e) => e.DurableExecutionName === executionName);
      if (execution) {
        executionArn = execution.DurableExecutionArn;
        break;
      }
    } catch {
      // API might not be ready yet
    }
    if (isTTY) {
      process.stdout.write(`\r    ${c.dim("Finding execution ARN...")} ${c.dim(SPINNER[attempt % SPINNER.length])} `);
    }
    await sleep(2000);
  }

  if (isTTY) process.stdout.write("\r" + " ".repeat(50) + "\r");
  if (!executionArn) {
    console.log(`    ${c.red("✗")} Could not find execution. Check the Lambda console.`);
    return;
  }
  console.log(`    ${c.green("✓")} ${c.dim(`ARN: ${executionArn}`)}`);

  const arnRegion = executionArn.split(":")[3];
  const logGroup = `/aws/lambda/${baseFunctionName}`;
  const encodedLogGroup = logGroup.replace(/\//g, "$252F");
  console.log(`    ${c.dim(`Logs: https://${arnRegion}.console.aws.amazon.com/cloudwatch/home?region=${arnRegion}#logsV2:log-groups/log-group/${encodedLogGroup}`)}`);

  // Poll and interact
  await pollAndInteract(executionArn, rl);
}

// ---------------------------------------------------------------------------
// Execution history types
// ---------------------------------------------------------------------------

interface HistoryEvent {
  EventType: string;
  SubType?: string;
  Id: string;
  Name?: string;
  ParentId?: string;
  EventTimestamp?: string;
  CallbackStartedDetails?: { CallbackId: string };
  StepSucceededDetails?: { Result?: { Payload?: string } };
}

function findPendingCallbacks(
  events: HistoryEvent[],
  handledCallbacks: Set<string>
): Array<{ name: string; callbackId: string }> {
  const startedCallbacks = new Map<string, { callbackId: string; parentId: string }>();
  const completedCallbackIds = new Set<string>();
  const contextNames = new Map<string, string>();

  for (const event of events) {
    if (event.EventType === "ContextStarted" && event.Name) {
      contextNames.set(event.Id, event.Name);
    }
    if (event.EventType === "CallbackStarted" && event.CallbackStartedDetails?.CallbackId) {
      startedCallbacks.set(event.Id, {
        callbackId: event.CallbackStartedDetails.CallbackId,
        parentId: event.ParentId || "",
      });
    }
    if (event.EventType === "CallbackSucceeded" || event.EventType === "CallbackFailed") {
      completedCallbackIds.add(event.Id);
    }
  }

  const pending: Array<{ name: string; callbackId: string }> = [];
  for (const [id, { callbackId, parentId }] of startedCallbacks) {
    if (!completedCallbackIds.has(id) && !handledCallbacks.has(callbackId)) {
      pending.push({ name: contextNames.get(parentId) || "unknown", callbackId });
    }
  }
  return pending;
}

function findStepTiming(events: HistoryEvent[], stepName: string): number | null {
  let startTime: number | null = null;
  let endTime: number | null = null;
  for (const event of events) {
    if (event.Name !== stepName) continue;
    const ts = event.EventTimestamp ? new Date(event.EventTimestamp).getTime() : null;
    if (event.EventType === "StepStarted" && ts) startTime = ts;
    if (event.EventType === "StepSucceeded" && ts) endTime = ts;
  }
  return startTime && endTime ? endTime - startTime : null;
}

function findCompletedSteps(events: HistoryEvent[]): string[] {
  return events
    .filter((e) => e.EventType === "StepSucceeded" && e.Name)
    .map((e) => e.Name!);
}

function findParallelBranches(events: HistoryEvent[]): string[] {
  const parallelContexts = new Set<string>();
  const branchNames: string[] = [];
  for (const event of events) {
    if (event.EventType === "ContextStarted" && event.SubType === "Parallel" && event.Name) {
      parallelContexts.add(event.Id);
    }
  }
  for (const event of events) {
    if (event.EventType === "ContextStarted" && event.ParentId && parallelContexts.has(event.ParentId) && event.Name) {
      branchNames.push(event.Name);
    }
  }
  return branchNames;
}

async function pollAndInteract(
  executionArn: string,
  rl: readline.Interface
): Promise<void> {
  const handledCallbacks = new Set<string>();
  const shownSteps = new Set<string>();

  for (let poll = 0; poll < 120; poll++) {
    await sleep(3000);

    let execution: { Status: string; Result?: string };
    try {
      execution = cliJson(
        `aws lambda get-durable-execution --durable-execution-arn "${executionArn}" --output json`
      );
    } catch {
      continue;
    }

    let historyEvents: HistoryEvent[] = [];
    let pendingCallbacks: Array<{ name: string; callbackId: string }> = [];
    try {
      const history = cliJson<{ Events: HistoryEvent[] }>(
        `aws lambda get-durable-execution-history --durable-execution-arn "${executionArn}" --include-execution-data --output json`
      );
      historyEvents = history.Events;
      if (execution.Status === "RUNNING") {
        pendingCallbacks = findPendingCallbacks(historyEvents, handledCallbacks);
      }
    } catch {
      // History not available yet
    }

    // Show completed specialist steps as they appear
    const completedSteps = findCompletedSteps(historyEvents);
    for (const stepName of completedSteps) {
      if (shownSteps.has(stepName)) continue;
      shownSteps.add(stepName);

      if (stepName in SPECIALIST_DISPLAY) {
        const durationMs = findStepTiming(historyEvents, stepName);
        console.log();
        printStep(stepName, `${SPECIALIST_DISPLAY[stepName]} specialist responded`);
        printCheckpoint(stepName, durationMs ?? 0);
      } else if (stepName === "routing-summary") {
        // Try to extract routing data from the step result
        const routingEvent = historyEvents.find(
          (e) => e.EventType === "StepSucceeded" && e.Name === "routing-summary"
        );
        const payload = routingEvent?.StepSucceededDetails?.Result?.Payload;
        if (payload) {
          try {
            const routing = JSON.parse(payload);
            console.log();
            printRouting(routing.called ?? [], routing.skipped ?? []);
          } catch {
            console.log();
            printStep("routing-summary", "Routing summary checkpointed");
          }
        }
      }
    }

    // Handle pending callbacks
    if (pendingCallbacks.length > 0) {
      for (const cb of pendingCallbacks) {
        if (cb.name === "approval") {
          console.log();
          printSuspend("approval");

          // Extract the recommendation from the synthesize step so the
          // approver can review it before deciding.
          const synthesizeEvent = historyEvents.find(
            (e) => e.EventType === "StepSucceeded" && e.Name === "synthesize"
          );
          const recPayload = synthesizeEvent?.StepSucceededDetails?.Result?.Payload;
          if (recPayload) {
            try {
              const recommendation = JSON.parse(recPayload);
              console.log(`  ${c.cyan(RULE)}`);
              console.log(`  ${c.cyan("Recommendation")}`);
              console.log();
              wrapText(typeof recommendation === "string" ? recommendation : JSON.stringify(recommendation, null, 2), 56)
                .forEach((line) => console.log(`  ${line}`));
              console.log(`  ${c.cyan(RULE)}`);
              console.log();
            } catch {
              // Could not parse — continue without showing
            }
          }

          printRoleHeader("YOU ARE THE PURCHASE APPROVER");

          console.log(`  ${c.dim("Review the recommendation above and decide whether to approve.")}`);
          console.log();

          const approved = await askYesNo(rl, "Approve this purchase recommendation?");
          let notes = "";
          if (approved) {
            notes = await rl.question(`  ${c.yellow(">")} Approval notes (optional): `);
          } else {
            notes = await rl.question(`  ${c.yellow(">")} Rejection reason: `);
          }

          const review: ApprovalPayload = { approved, notes: notes || undefined };

          try {
            cli(
              `aws lambda send-durable-execution-callback-success ` +
              `--callback-id "${cb.callbackId}" ` +
              `--cli-binary-format raw-in-base64-out ` +
              `--result ${shellQuote(JSON.stringify(review))}`
            );
            console.log();
            printResume("approval");
          } catch (err) {
            console.log(`    ${c.red("✗")} Failed to send callback: ${(err as Error).message}`);
          }

          handledCallbacks.add(cb.callbackId);
        }
      }
    }

    // Terminal states
    if (execution.Status === "SUCCEEDED") {
      const branches = findParallelBranches(historyEvents);
      if (branches.length > 0) {
        console.log();
        printParallel("specialists", branches.map((name) => `${name}: Done`));
      }

      console.log(`  ${c.green("▶")} ${c.bold("Execution completed successfully")}`);
      if (execution.Result) {
        try {
          const result = JSON.parse(execution.Result);
          printResult(result);
        } catch {
          console.log(`  ${c.dim("Result:")} ${execution.Result}`);
        }
      }
      return;
    }

    if (execution.Status === "FAILED" || execution.Status === "TIMED_OUT" || execution.Status === "STOPPED") {
      console.log();
      console.log(`  ${c.red("▶")} ${c.bold(`Execution ${execution.Status}`)}`);
      return;
    }
  }

  console.log();
  console.log(`  ${c.yellow("⚠")} Polling timed out. Check the Lambda console for execution status.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isCloud = args.includes("--cloud");
  const scenarioArg = args.find((a) => a.startsWith("--ticket="))?.split("=")[1];
  const profileArg = args.find((a) => a.startsWith("--profile="))?.split("=")[1];
  const regionArg = args.find((a) => a.startsWith("--region="))?.split("=")[1];
  const functionArnArg = args.find((a) => a.startsWith("--function-arn="))?.split("=")[1];

  if (profileArg) awsFlags.push(`--profile ${profileArg}`);
  if (regionArg) awsFlags.push(`--region ${regionArg}`);
  if (functionArnArg) cloudFunctionArn = functionArnArg;

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    printHeader();

    // Select mode
    let mode: "local" | "cloud";
    if (isCloud) {
      mode = "cloud";
    } else if (args.includes("--local")) {
      mode = "local";
    } else {
      const modeChoice = await askChoice(rl, "Select a mode:", [
        "Local (mocked, no AWS needed)",
        "Cloud (real Lambda + Bedrock, requires deployment)",
      ]);
      mode = modeChoice === 0 ? "local" : "cloud";
      console.log();
    }

    // Prompt for AWS config in cloud mode
    if (mode === "cloud" && !profileArg && !regionArg) {
      const profile = await rl.question(`  ${c.yellow(">")} AWS profile ${c.dim("(leave empty for default)")}: `);
      const region = await rl.question(`  ${c.yellow(">")} AWS region ${c.dim("(leave empty for default)")}: `);
      if (profile.trim()) awsFlags.push(`--profile ${profile.trim()}`);
      if (region.trim()) awsFlags.push(`--region ${region.trim()}`);
      console.log();
    }

    // Resolve function ARN in cloud mode
    if (mode === "cloud" && !cloudFunctionArn) {
      const stackName = await rl.question(`  ${c.yellow(">")} Stack name ${c.dim("(default: durable-multi-agent-purchasing)")}: `);
      const stack = stackName.trim() || "durable-multi-agent-purchasing";
      try {
        cloudFunctionArn = cli(
          `aws cloudformation describe-stacks --stack-name ${stack} ` +
          `--query "Stacks[0].Outputs[?OutputKey=='CoordinatorFunctionArn'].OutputValue" --output text`
        );
        console.log(`    ${c.green("✓")} ${c.dim(`Function: ${cloudFunctionArn}`)}`);
      } catch {
        console.log(`    ${c.red("✗")} Could not find stack "${stack}". Deploy first or use --function-arn=<arn>`);
        return;
      }
      console.log();
    }

    // Select scenario
    let scenario: string;
    if (scenarioArg && SCENARIOS[scenarioArg]) {
      scenario = scenarioArg;
    } else {
      const choice = await askChoice(rl, "Select a purchase scenario:", [
        `Laptop ($1,500) ${c.dim("— 2 specialists, no approval")}`,
        `Used car ($18,000) ${c.dim("— 5 specialists, requires approval")}`,
        `SaaS subscription ($200/mo) ${c.dim("— 2 specialists, requires approval")}`,
      ]);
      scenario = ["laptop", "used-car", "saas"][choice];
      console.log();
    }

    const data = SCENARIOS[scenario];

    if (mode === "local") {
      await runLocal(scenario, data, rl);
    } else {
      await runCloud(scenario, data, rl);
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(c.red(`Error: ${err.message}`));
  process.exit(1);
});
