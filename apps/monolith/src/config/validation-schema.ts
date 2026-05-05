import { z } from 'zod'

export const MonolithConfigSchema = z.strictObject({
	app: z.strictObject({
		env: z.enum(['development', 'production', 'test']),
		port: z.number().int().min(1).max(65535)
	}),
	usersDb: z.strictObject({
		readUrl: z.string().min(1),
		writeUrl: z.string().min(1)
	}),
	notificationsDb: z.strictObject({
		readUrl: z.string().min(1),
		writeUrl: z.string().min(1)
	}),
	rabbitmq: z.strictObject({
		url: z.string().min(1)
	}),
	cron: z.strictObject({
		usersExpr: z.string().min(1),
		notifierExpr: z.string().min(1)
	}),
	outbox: z.strictObject({
		batchSize: z.number().int().min(1).max(10_000),
		stuckThresholdMs: z.number().int().min(1_000)
	}),
	notifier: z.strictObject({
		batchSize: z.number().int().min(1).max(10_000),
		notificationDelayMs: z.number().int().min(0),
		recoveryThresholdMs: z.number().int().min(1_000)
	}),
	push: z.strictObject({
		webhookUrl: z.url(),
		httpTimeoutMs: z.number().int().min(100).max(60_000)
	})
})

export type MonolithConfig = z.infer<typeof MonolithConfigSchema>
