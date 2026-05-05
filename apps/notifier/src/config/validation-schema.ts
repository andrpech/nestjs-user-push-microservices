import { z } from 'zod'

export const NotifierConfigSchema = z.strictObject({
	app: z.strictObject({
		env: z.enum(['development', 'production', 'test']),
		port: z.number().int().min(1).max(65535)
	}),
	notificationsDb: z.strictObject({
		readUrl: z.string().min(1),
		writeUrl: z.string().min(1)
	}),
	rabbitmq: z.strictObject({
		url: z.string().min(1)
	}),
	notifier: z.strictObject({
		batchSize: z.number().int().min(1).max(10_000),
		notificationDelayMs: z.number().int().min(0),
		recoveryThresholdMs: z.number().int().min(1_000)
	}),
	push: z.strictObject({
		webhookUrl: z.url(),
		httpTimeoutMs: z.number().int().min(100).max(60_000),
		maxAttempts: z.number().int().min(1).max(20)
	}),
	retry: z.strictObject({
		inboxMaxAttempts: z.number().int().min(1).max(20),
		maxRedrives: z.number().int().min(1).max(20)
	})
})

export type NotifierConfig = z.infer<typeof NotifierConfigSchema>
