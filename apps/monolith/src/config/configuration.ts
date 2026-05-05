import { ConfigModule, ConfigType, registerAs } from '@nestjs/config'

import { MonolithConfigSchema } from './validation-schema'

export const configuration = registerAs('app', () => {
	const config = {
		app: {
			env: process.env.NODE_ENV as 'development' | 'production' | 'test',
			port: Number.parseInt(process.env.PORT ?? '3000', 10)
		},
		usersDb: {
			readUrl: process.env.USERS_READ_DB_URL ?? '',
			writeUrl: process.env.USERS_WRITE_DB_URL ?? ''
		},
		notificationsDb: {
			readUrl: process.env.NOTIFICATIONS_READ_DB_URL ?? '',
			writeUrl: process.env.NOTIFICATIONS_WRITE_DB_URL ?? ''
		},
		rabbitmq: {
			url: process.env.RABBITMQ_URL ?? ''
		},
		cron: {
			usersExpr: process.env.USERS_CRON_EXPR ?? '*/5 * * * * *',
			notifierExpr: process.env.NOTIFIER_CRON_EXPR ?? '*/5 * * * * *'
		},
		outbox: {
			batchSize: Number.parseInt(process.env.OUTBOX_BATCH_SIZE ?? '100', 10),
			stuckThresholdMs: Number.parseInt(process.env.OUTBOX_STUCK_THRESHOLD_MS ?? '300000', 10)
		},
		notifier: {
			batchSize: Number.parseInt(process.env.NOTIFIER_BATCH_SIZE ?? '100', 10),
			notificationDelayMs: Number.parseInt(process.env.NOTIFICATION_DELAY_MS ?? '30000', 10),
			recoveryThresholdMs: Number.parseInt(process.env.RECOVERY_THRESHOLD_MS ?? '300000', 10)
		},
		push: {
			webhookUrl: process.env.WEBHOOK_URL ?? '',
			httpTimeoutMs: Number.parseInt(process.env.PUSH_HTTP_TIMEOUT_MS ?? '5000', 10)
		}
	}

	MonolithConfigSchema.parse(config)

	return config
})

export const ConfigurationModule = ConfigModule.forFeature(configuration)
export const ConfigurationInjectKey = configuration.KEY
export type ConfigurationType = ConfigType<typeof configuration>
