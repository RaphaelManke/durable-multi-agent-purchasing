// Ambient declaration for @aws/durable-execution-sdk-js-otel@1.0.0.
//
// The published npm tarball's package.json points "types" at
// "./dist-types/index.d.ts", but that directory is missing from the
// tarball (upstream packaging bug — verified via `npm pack`). This
// declares only the surface this project actually uses.
declare module "@aws/durable-execution-sdk-js-otel" {
  import type { DurableInstrumentationPlugin } from "@aws/durable-execution-sdk-js"
  import type { TracerProvider } from "@opentelemetry/api"

  export interface OtelPluginConfig {
    tracerProviderFactory?: (createIdGenerator: (fallbackIdGenerator?: unknown) => unknown) => TracerProvider
    contextExtractor?: (...args: unknown[]) => unknown
    instrumentationName?: string
    workflowSpanName?: string
    enrichLogger?: boolean
  }

  export class ExecutionOtelPlugin implements DurableInstrumentationPlugin {
    constructor(config?: OtelPluginConfig)
    onInvocationStart?: DurableInstrumentationPlugin["onInvocationStart"]
    onInvocationEnd?: DurableInstrumentationPlugin["onInvocationEnd"]
    onOperationStart?: DurableInstrumentationPlugin["onOperationStart"]
    onOperationEnd?: DurableInstrumentationPlugin["onOperationEnd"]
    onOperationAttemptStart?: DurableInstrumentationPlugin["onOperationAttemptStart"]
    onOperationAttemptEnd?: DurableInstrumentationPlugin["onOperationAttemptEnd"]
  }

  export class InvocationOtelPlugin implements DurableInstrumentationPlugin {
    constructor(config?: OtelPluginConfig)
    onInvocationStart?: DurableInstrumentationPlugin["onInvocationStart"]
    onInvocationEnd?: DurableInstrumentationPlugin["onInvocationEnd"]
    onOperationStart?: DurableInstrumentationPlugin["onOperationStart"]
    onOperationEnd?: DurableInstrumentationPlugin["onOperationEnd"]
    onOperationAttemptStart?: DurableInstrumentationPlugin["onOperationAttemptStart"]
    onOperationAttemptEnd?: DurableInstrumentationPlugin["onOperationAttemptEnd"]
  }
}
