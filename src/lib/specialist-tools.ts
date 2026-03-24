import { tool } from '@strands-agents/sdk'
import { z } from 'zod'
import type { makeLogger } from './logger.js'

type Logger = ReturnType<typeof makeLogger>

/**
 * Returns specialist-specific tools by prompt name.
 * Most specialists are pure reasoning (no tools). The price-research specialist
 * demonstrates how a specialist can interact with external systems — here it
 * logs a structured price snapshot that could be saved to DynamoDB in production.
 */
export function loadSpecialistTools(name: string, logger: Logger) {
  switch (name) {
    case 'price-research':
      return [
        tool({
          name: 'save_price_snapshot',
          description: 'Log a structured price snapshot with budget, mid-range, and premium price points.',
          inputSchema: z.object({
            item: z.string().describe('What was researched'),
            budget: z.string().describe('Budget price point'),
            midRange: z.string().describe('Mid-range price point'),
            premium: z.string().describe('Premium price point'),
            currency: z.string().optional().describe('Currency code (default: USD)'),
          }),
          callback: async (input) => {
            // In production: write to DynamoDB, S3, or a pricing service.
            logger.info('price_snapshot_saved', {
              item: input.item,
              budget: input.budget,
              midRange: input.midRange,
              premium: input.premium,
              currency: input.currency ?? 'USD',
            })
            return `Price snapshot logged for ${input.item}: ${input.budget} / ${input.midRange} / ${input.premium}`
          },
        }),
      ]
    default:
      return []
  }
}
