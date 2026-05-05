import { ConfigModule, ConfigType, registerAs } from '@nestjs/config'

import { MonolithConfigSchema } from './validation-schema'

export const configuration = registerAs('app', () => {
	const config = {
		app: {
			env: process.env.NODE_ENV as 'development' | 'production' | 'test',
			port: Number.parseInt(process.env.PORT ?? '3000', 10)
		}
	}

	MonolithConfigSchema.parse(config)

	return config
})

export const ConfigurationModule = ConfigModule.forFeature(configuration)
export const ConfigurationInjectKey = configuration.KEY
export type ConfigurationType = ConfigType<typeof configuration>
