import { ConfigModule, ConfigType, registerAs } from '@nestjs/config'

import { SchedulerConfigSchema } from './validation-schema'

export const configuration = registerAs('app', () => {
	const config = {
		app: {
			env: process.env.NODE_ENV as 'development' | 'production' | 'test',
			port: Number.parseInt(process.env.PORT ?? '3002', 10)
		},
		rabbitmq: {
			url: process.env.RABBITMQ_URL ?? ''
		},
		cron: {
			usersExpr: process.env.USERS_CRON_EXPR ?? '*/5 * * * * *',
			notifierExpr: process.env.NOTIFIER_CRON_EXPR ?? '*/5 * * * * *'
		}
	}

	SchedulerConfigSchema.parse(config)

	return config
})

export const ConfigurationModule = ConfigModule.forFeature(configuration)
export const ConfigurationInjectKey = configuration.KEY
export type ConfigurationType = ConfigType<typeof configuration>
