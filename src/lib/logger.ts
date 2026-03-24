/**
 * Structured JSON logger for non-durable handlers (specialists).
 *
 * The coordinator uses context.logger (replay-aware) from the durable execution
 * SDK. Specialists are standard Lambda functions and use this logger instead.
 * All log lines are newline-delimited JSON for CloudWatch Logs Insights.
 */

export interface LogContext {
  handler: string
  requestId: string
}

type Level = 'INFO' | 'WARN' | 'ERROR'

function log(level: Level, ctx: LogContext, event: string, data?: Record<string, unknown>): void {
  console.log(JSON.stringify({
    level,
    handler: ctx.handler,
    requestId: ctx.requestId,
    event,
    timestamp: new Date().toISOString(),
    ...data,
  }))
}

export function makeLogger(ctx: LogContext) {
  return {
    info: (event: string, data?: Record<string, unknown>) => log('INFO', ctx, event, data),
    warn: (event: string, data?: Record<string, unknown>) => log('WARN', ctx, event, data),
    error: (event: string, data?: Record<string, unknown>) => log('ERROR', ctx, event, data),
  }
}
