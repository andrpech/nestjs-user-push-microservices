import { Module } from '@nestjs/common'
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino'

import { ulid } from './ulid'

@Module({
	imports: [
		PinoLoggerModule.forRoot({
			pinoHttp: {
				genReqId: (): string => ulid(),
				customProps: (): Record<string, unknown> => ({}),
				transport:
					process.env.NODE_ENV === 'production'
						? undefined
						: {
								target: 'pino-pretty',
								options: { singleLine: true, colorize: true }
							},
				autoLogging: true,
				serializers: {
					req: (req: {
						id: string
						method: string
						url: string
					}): {
						id: string
						method: string
						url: string
					} => ({ id: req.id, method: req.method, url: req.url }),
					res: (res: { statusCode: number }): { statusCode: number } => ({
						statusCode: res.statusCode
					})
				}
			}
		})
	],
	exports: [PinoLoggerModule]
})
export class LoggerModule {}
