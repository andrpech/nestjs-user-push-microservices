import { z } from 'zod'

export const CronTickSchema = z.strictObject({
	at: z.string().min(1)
})

export type CronTick = z.infer<typeof CronTickSchema>
