import { ConfigModule, ConfigType, registerAs } from '@nestjs/config'

import { NotifierConfigSchema } from './validation-schema'

export const configuration = registerAs('app', () => {
	const config = {
		app: {
			env: process.env.NODE_ENV as 'development' | 'production' | 'test',
			port: Number.parseInt(process.env.PORT ?? '3001', 10)
		},
		notificationsDb: {
			readUrl: process.env.NOTIFICATIONS_READ_DB_URL ?? '',
			writeUrl: process.env.NOTIFICATIONS_WRITE_DB_URL ?? ''
		},
		rabbitmq: {
			url: process.env.RABBITMQ_URL ?? '',
			mgmtUrl: process.env.RABBITMQ_MGMT_URL ?? ''
		},
		notifier: {
			batchSize: Number.parseInt(process.env.NOTIFIER_BATCH_SIZE ?? '100', 10),
			notificationDelayMs: Number.parseInt(process.env.NOTIFICATION_DELAY_MS ?? '30000', 10),
			recoveryThresholdMs: Number.parseInt(process.env.RECOVERY_THRESHOLD_MS ?? '300000', 10)
		},
		push: {
			webhookUrl: process.env.WEBHOOK_URL ?? '',
			httpTimeoutMs: Number.parseInt(process.env.PUSH_HTTP_TIMEOUT_MS ?? '5000', 10),
			maxAttempts: Number.parseInt(process.env.PUSH_MAX_ATTEMPTS ?? '5', 10)
		},
		retry: {
			inboxMaxAttempts: Number.parseInt(process.env.INBOX_MAX_ATTEMPTS ?? '5', 10),
			maxRedrives: Number.parseInt(process.env.MAX_REDRIVES ?? '5', 10)
		}
	}

	NotifierConfigSchema.parse(config)

	return config
})

export const ConfigurationModule = ConfigModule.forFeature(configuration)
export const ConfigurationInjectKey = configuration.KEY
export type ConfigurationType = ConfigType<typeof configuration>
