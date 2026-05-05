import { z } from 'zod'

export const SchedulerConfigSchema = z.strictObject({
	app: z.strictObject({
		env: z.enum(['development', 'production', 'test']),
		port: z.number().int().min(1).max(65535)
	}),
	rabbitmq: z.strictObject({
		url: z.string().min(1)
	}),
	cron: z.strictObject({
		usersExpr: z.string().min(1),
		notifierExpr: z.string().min(1)
	})
})

export type SchedulerConfig = z.infer<typeof SchedulerConfigSchema>
