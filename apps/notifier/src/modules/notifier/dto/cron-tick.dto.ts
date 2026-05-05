import { z } from 'zod'

// Mirror of the producer-side schema in apps/scheduler. Each app owns its own
// view of inter-service contracts.
export const CronTickSchema = z.strictObject({
	at: z.string().min(1)
})

export type CronTick = z.infer<typeof CronTickSchema>
