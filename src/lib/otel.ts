import type { DurableInstrumentationPluginFactory } from '@aws/durable-execution-sdk-js'
import {
  createExecutionOtelPluginFactory,
  createInvocationOtelPluginFactory,
} from '@aws/durable-execution-sdk-js-otel'

/**
 * Tracing plugins for the durable coordinator, selected by the OTEL_PLUGIN
 * environment variable set in template.yaml:
 *   unset        no plugin (steps 05 to 07)
 *   "execution"  ExecutionOtelPlugin: workflow-centered view (step 08)
 *   "invocation" InvocationOtelPlugin: invocation-centered view (step 10)
 *
 * The OTel provider comes from the Lambda layer (global provider). Without
 * OTEL_PLUGIN no plugin is registered and the package does nothing.
 */
export function loadOtelPlugins(): DurableInstrumentationPluginFactory[] {
  const mode = process.env.OTEL_PLUGIN
  if (!mode) return []
  if (mode === 'execution') return [createExecutionOtelPluginFactory()]
  if (mode === 'invocation') return [createInvocationOtelPluginFactory()]
  throw new Error(`Unknown OTEL_PLUGIN value: "${mode}"`)
}
