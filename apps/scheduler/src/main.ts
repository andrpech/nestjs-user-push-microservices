import 'dotenv/config'
import '@app/tracing/register'

import { Logger as BaseLogger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { Logger as PinoLogger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { ConfigurationInjectKey, ConfigurationType } from './config'

const bootstrap = async (): Promise<void> => {
	const app = await NestFactory.create<NestFastifyApplication>(
		AppModule,
		new FastifyAdapter({ trustProxy: true }),
		{ bufferLogs: true }
	)

	app.useLogger(app.get(PinoLogger))

	const config = app.get<ConfigurationType>(ConfigurationInjectKey)

	app.enableShutdownHooks()

	await app.listen(config.app.port, '0.0.0.0')

	BaseLogger.log(`🚀 Scheduler service started on port ${config.app.port}`, 'bootstrap')
}

bootstrap().catch((error) => {
	console.error('Bootstrap failed:', error)
	process.exit(1)
})
