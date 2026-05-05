import { z } from 'zod'

export const UsersConfigSchema = z.strictObject({
	app: z.strictObject({
		env: z.enum(['development', 'production', 'test']),
		port: z.number().int().min(1).max(65535)
	}),
	usersDb: z.strictObject({
		readUrl: z.string().min(1),
		writeUrl: z.string().min(1)
	}),
	rabbitmq: z.strictObject({
		url: z.string().min(1)
	}),
	outbox: z.strictObject({
		batchSize: z.number().int().min(1).max(10_000),
		stuckThresholdMs: z.number().int().min(1_000)
	})
})

export type UsersConfig = z.infer<typeof UsersConfigSchema>
