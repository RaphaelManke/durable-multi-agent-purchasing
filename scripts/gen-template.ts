/**
 * Generates template.yaml (stack "dfdemo").
 *
 * One big SAM template: every demo step has its own function(s), each with an
 * alias `live`, its own IAM role and (for durable ones) its own durable config.
 * Tracing variants are duplicated functions. SAM Globals cannot carry
 * Metadata, so the repeated esbuild settings are generated here.
 *
 * Usage:
 *   tsx scripts/gen-template.ts            write template.yaml
 *   tsx scripts/gen-template.ts --check    exit 1 if template.yaml is stale
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Minimal YAML emitter (block style, CloudFormation short-form tags)
// ---------------------------------------------------------------------------

class Tag {
  constructor(readonly tag: string, readonly value: unknown) {}
}
const Ref = (v: string) => new Tag('Ref', v)
const Sub = (v: string) => new Tag('Sub', v)
const GetAtt = (v: string) => new Tag('GetAtt', v)

type Yaml = string | number | boolean | Tag | Yaml[] | { [k: string]: Yaml }

function scalar(v: string | number | boolean): string {
  if (typeof v !== 'string') return String(v)
  const plain = /^[A-Za-z0-9_./$:{}-][A-Za-z0-9_ ./$:{}*@,=+>-]*$/.test(v)
    && !/^(true|false|null|yes|no|on|off|~)$/i.test(v)
    && !/^[0-9.eE+-]+$/.test(v)
    && !/: |:$| #/.test(v)
  if (plain) return v
  return v.includes("'") ? JSON.stringify(v) : `'${v}'`
}

function emit(value: Yaml, indent: number): string[] {
  const pad = ' '.repeat(indent)
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (item instanceof Tag || typeof item !== 'object') return [`${pad}- ${inline(item)}`]
      const [first, ...rest] = emit(item, indent + 2)
      return [`${pad}- ${first.trimStart()}`, ...rest]
    })
  }
  if (value instanceof Tag || typeof value !== 'object') return [`${pad}${inline(value)}`]
  return Object.entries(value).flatMap(([k, v]) => {
    if (v instanceof Tag || typeof v !== 'object') return [`${pad}${k}: ${inline(v)}`]
    if (Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0) return [`${pad}${k}: ${Array.isArray(v) ? '[]' : '{}'}`]
    return [`${pad}${k}:`, ...emit(v, indent + 2)]
  })
}

function inline(v: Yaml): string {
  if (v instanceof Tag) return `!${v.tag} ${scalar(String(v.value))}`
  return scalar(v as string | number | boolean)
}

// ---------------------------------------------------------------------------
// Model and layer configuration
// ---------------------------------------------------------------------------

// ADOT Node.js layer, arm64 (legacy docs ARN format, account 901920570463).
const OTEL_LAYER = 'arn:aws:lambda:${AWS::Region}:901920570463:layer:aws-otel-nodejs-arm64-ver-1-30-2:6'
const OTEL_WRAPPER = '/opt/otel-handler'

const BEDROCK_ACTIONS = ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream']
const BASIC_DURABLE = 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicDurableExecutionRolePolicy'
const XRAY_DAEMON = 'arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess'

type ModelParam = 'CoordinatorModelId' | 'SpecialistModelId' | 'AdvancedSpecialistModelId'

const bedrockPolicy = (param: ModelParam): Yaml => ({
  Statement: [{
    Effect: 'Allow',
    Action: BEDROCK_ACTIONS,
    Resource: [
      Sub(`arn:aws:bedrock:*::foundation-model/\${${param}}`),
      Sub(`arn:aws:bedrock:\${AWS::Region}:\${AWS::AccountId}:inference-profile/global.\${${param}}`),
    ],
  }],
})

// ---------------------------------------------------------------------------
// Function builder
// ---------------------------------------------------------------------------

type Tracing = 'none' | 'xray' | 'otel'

interface FnSpec {
  id: string // logical id
  name: string // dfdemo-NN-<name>
  dir: string // src/steps/<folder>
  entry: string // handler file without extension
  memory: number
  timeout: number
  durable?: { executionTimeout: number }
  env?: Record<string, Yaml>
  policies?: Yaml[]
  tracing: Tracing
  comment?: string
}

function fn(spec: FnSpec): { comment?: string; resource: Yaml } {
  const env: Record<string, Yaml> = { ...(spec.env ?? {}) }
  const policies: Yaml[] = []
  if (spec.durable) policies.push(BASIC_DURABLE)
  policies.push(...(spec.policies ?? []))
  const props: Record<string, Yaml> = {
    FunctionName: spec.name,
    CodeUri: `${spec.dir}/`,
    Handler: `${spec.entry}.handler`,
    MemorySize: spec.memory,
    Timeout: spec.timeout,
  }
  if (spec.tracing !== 'none') props.Tracing = 'Active'
  if (spec.tracing === 'otel') {
    props.Layers = [Sub(OTEL_LAYER)]
    env.AWS_LAMBDA_EXEC_WRAPPER = OTEL_WRAPPER
    policies.push(XRAY_DAEMON)
  }
  if (Object.keys(env).length) props.Environment = { Variables: env }
  props.Policies = policies
  if (spec.durable) {
    props.DurableConfig = { ExecutionTimeout: spec.durable.executionTimeout, RetentionPeriodInDays: 7 }
  }
  props.AutoPublishAlias = 'live'
  return {
    comment: spec.comment,
    resource: {
      Type: 'AWS::Serverless::Function',
      Properties: props,
      Metadata: {
        BuildMethod: 'esbuild',
        BuildProperties: {
          Minify: false,
          Target: 'es2022',
          Format: 'esm',
          OutExtension: ['.js=.mjs'],
          EntryPoints: [`${spec.entry}.ts`],
          External: ['@aws-sdk/*'],
          Banner: ["js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);"],
        },
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Function catalog
// ---------------------------------------------------------------------------

const SPECIALISTS = [
  { key: 'price', prompt: 'price-research', env: 'PRICE_RESEARCH_FUNCTION', model: 'SpecialistModelId' },
  { key: 'financing', prompt: 'financing', env: 'FINANCING_FUNCTION', model: 'SpecialistModelId' },
  { key: 'delivery', prompt: 'delivery', env: 'DELIVERY_FUNCTION', model: 'SpecialistModelId' },
  { key: 'risk', prompt: 'risk-assessment', env: 'RISK_ASSESSMENT_FUNCTION', model: 'AdvancedSpecialistModelId' },
  { key: 'contract', prompt: 'contract-review', env: 'CONTRACT_REVIEW_FUNCTION', model: 'SpecialistModelId' },
] as const

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const idOf = (...parts: string[]) => parts.map((p) => p.split('-').map(cap).join('')).join('')

const SPLIT_DIR = 'src/steps/05-split'

interface Group {
  prefix: string // e.g. "05" (logical id prefix)
  label: string // e.g. "05-coordinator"
  specialistPrefix: string // e.g. "dfdemo-05"
  tracing: Tracing
}

/** Specialists for one tracing variant. Returns specs keyed by specialist key. */
function specialistSpecs(prefix: string, namePrefix: string, tracing: Tracing, comment?: string): FnSpec[] {
  return SPECIALISTS.map((s, i) => ({
    id: idOf('Fn', prefix, s.key),
    name: `${namePrefix}-${s.key}`,
    dir: SPLIT_DIR,
    entry: 'specialist',
    memory: 1024,
    timeout: 60,
    env: { PROMPT_NAME: s.prompt, SPECIALIST_MODEL_ID: Sub(`global.\${${s.model}}`) },
    policies: [bedrockPolicy(s.model)],
    tracing,
    comment: i === 0 ? comment : undefined,
  }))
}

/** Coordinator wired to a set of specialist logical ids. */
function coordinatorSpec(opts: {
  id: string
  name: string
  specialistIds: string[]
  tracing: Tracing
  otelPlugin?: 'execution' | 'invocation'
  comment?: string
}): FnSpec {
  const env: Record<string, Yaml> = { COORDINATOR_MODEL_ID: Sub('global.${CoordinatorModelId}') }
  SPECIALISTS.forEach((s, i) => { env[s.env] = Ref(opts.specialistIds[i]) })
  if (opts.otelPlugin) env.OTEL_PLUGIN = opts.otelPlugin
  return {
    id: opts.id,
    name: opts.name,
    dir: SPLIT_DIR,
    entry: 'coordinator',
    memory: 1536,
    timeout: 300,
    durable: { executionTimeout: 86400 },
    env,
    policies: [
      {
        Statement: [
          {
            Effect: 'Allow',
            Action: BEDROCK_ACTIONS,
            Resource: [
              Sub('arn:aws:bedrock:*::foundation-model/${CoordinatorModelId}'),
              Sub('arn:aws:bedrock:${AWS::Region}:${AWS::AccountId}:inference-profile/global.${CoordinatorModelId}'),
            ],
          },
          { Effect: 'Allow', Action: 'lambda:InvokeFunction', Resource: opts.specialistIds.map((id) => GetAtt(`${id}.Arn`)) },
        ],
      },
    ],
    tracing: opts.tracing,
    comment: opts.comment,
  }
}

const functions: FnSpec[] = []

// 01 to 04: single-function steps
functions.push(
  {
    id: 'Fn01Retry', name: 'dfdemo-01-retry', dir: 'src/steps/01-retry', entry: 'handler',
    memory: 256, timeout: 30, durable: { executionTimeout: 300 }, tracing: 'none',
    comment: 'Step 01: two durable steps, the second fails once and is retried. No model.',
  },
  {
    id: 'Fn02Wait', name: 'dfdemo-02-wait', dir: 'src/steps/02-wait', entry: 'handler',
    memory: 256, timeout: 30, durable: { executionTimeout: 900 }, tracing: 'none',
    comment: 'Step 02: adds context.wait. Wait time is not billed.',
  },
  {
    id: 'Fn03ModelReplay', name: 'dfdemo-03-model-replay', dir: 'src/steps/03-model-replay', entry: 'handler',
    memory: 512, timeout: 60, durable: { executionTimeout: 900 }, tracing: 'none',
    env: { MODEL_ID: Sub('global.${SpecialistModelId}') },
    policies: [bedrockPolicy('SpecialistModelId')],
    comment: 'Step 03: model call A is replayed, not re-invoked, when model call B is retried.',
  },
  {
    id: 'Fn04Agent', name: 'dfdemo-04-agent', dir: 'src/steps/04-agent', entry: 'handler',
    memory: 1024, timeout: 120, durable: { executionTimeout: 900 }, tracing: 'none',
    env: { AGENT_MODEL_ID: Sub('global.${SpecialistModelId}') },
    policies: [bedrockPolicy('SpecialistModelId')],
    comment: 'Step 04: first Strands agent in one durable function.',
  },
)

// 05/06: coordinator + specialists, no tracing
const spec05 = specialistSpecs('05', 'dfdemo-05', 'none',
  'Steps 05/06: coordinator and one specialist function per permission boundary. No tracing.')
functions.push(
  coordinatorSpec({ id: 'Fn05Coordinator', name: 'dfdemo-05-coordinator', specialistIds: spec05.map((s) => s.id), tracing: 'none' }),
  ...spec05,
)

// 07: X-Ray active tracing everywhere
const spec07 = specialistSpecs('07Xray', 'dfdemo-07-xray', 'xray', 'Step 07: Tracing: Active (X-Ray) on the coordinator and all specialists.')
functions.push(
  coordinatorSpec({ id: 'Fn07XrayCoordinator', name: 'dfdemo-07-xray-coordinator', specialistIds: spec07.map((s) => s.id), tracing: 'xray' }),
  ...spec07,
)

// 08: OTel plugin (execution mode) + OTel layer on the coordinator only; specialists are plain
const spec08 = specialistSpecs('08Otel', 'dfdemo-08-otel', 'none',
  'Step 08: OTel plugin and OTel layer on the coordinator. Specialists carry no tracing (reused by step 10).')
functions.push(
  coordinatorSpec({
    id: 'Fn08OtelCoordinator', name: 'dfdemo-08-otel-coordinator', specialistIds: spec08.map((s) => s.id),
    tracing: 'otel', otelPlugin: 'execution',
  }),
  ...spec08,
)

// 10: switched tracing mode on the coordinator only, reusing the 08 specialists
functions.push(coordinatorSpec({
  id: 'Fn10OtelMode2Coordinator', name: 'dfdemo-10-otel-mode2-coordinator', specialistIds: spec08.map((s) => s.id),
  tracing: 'otel', otelPlugin: 'invocation',
  comment: 'Step 10: InvocationOtelPlugin (switched mode) on the coordinator only. Reuses the step 08 specialists.',
}))

// 11: tracing on all functions
const spec11 = specialistSpecs('11Otel', 'dfdemo-11-otel', 'otel',
  'Step 11: OTel layer and active tracing on every function. Shows context propagation.')
functions.push(
  coordinatorSpec({
    id: 'Fn11OtelAllCoordinator', name: 'dfdemo-11-otel-all-coordinator', specialistIds: spec11.map((s) => s.id),
    tracing: 'otel', otelPlugin: 'execution',
  }),
  ...spec11,
)

// ---------------------------------------------------------------------------
// Template assembly
// ---------------------------------------------------------------------------

function resourcesYaml(): string[] {
  const lines: string[] = []
  for (const spec of functions) {
    const { comment, resource } = fn(spec)
    if (comment) lines.push(`  # ${comment}`)
    lines.push(`  ${spec.id}:`, ...emit(resource, 4), '')
  }
  return lines
}

function outputsYaml(): string[] {
  const outputs: Record<string, Yaml> = {}
  for (const spec of functions) {
    outputs[`${spec.id}Arn`] = {
      Description: `${spec.name} ARN (qualified with :live alias)`,
      // SAM names the alias resource {FunctionLogicalId}Alias{AliasName}.
      Value: Ref(`${spec.id}Aliaslive`),
    }
  }
  return emit(outputs, 2)
}

export function generate(): string {
  const header = `AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: |
  Lambda durable functions step-by-step demo (stack dfdemo). One function per
  demo step, plus tracing variants of the coordinator and specialists.
  GENERATED by scripts/gen-template.ts. Do not edit by hand.

Parameters:
  CoordinatorModelId:
    Type: String
    Default: anthropic.claude-sonnet-4-6
    Description: Bedrock model ID for the coordinator (uses global inference profile
      prefix automatically)
  SpecialistModelId:
    Type: String
    Default: anthropic.claude-haiku-4-5-20251001-v1:0
    Description: Bedrock model ID for standard specialists (uses global inference
      profile prefix automatically)
  AdvancedSpecialistModelId:
    Type: String
    Default: anthropic.claude-sonnet-4-6
    Description: Bedrock model ID for specialists needing stronger reasoning (e.g.
      risk-assessment)

Globals:
  Function:
    Runtime: nodejs24.x
    Architectures:
      - arm64

Resources:`
  return [header, ...resourcesYaml(), 'Outputs:', ...outputsYaml(), ''].join('\n')
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'template.yaml')
const generated = generate()

if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8')
  if (current !== generated) {
    console.error('template.yaml is stale. Run: npm run gen:template')
    process.exit(1)
  }
  console.log('template.yaml is up to date')
} else {
  writeFileSync(target, generated)
  console.log(`wrote ${target}`)
}
