import { Module } from '@nestjs/common'
import { trace } from '@opentelemetry/api'
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino'

import { ulid } from './ulid'

// Pulls active span context onto every log line. Keys match OpenTelemetry
// log-correlation conventions used by Tempo/Loki/Jaeger.
const traceMixin = (): Record<string, string> => {
	const span = trace.getActiveSpan()
	if (!span) return {}
	const ctx = span.spanContext()
	if (!ctx.traceId) return {}
	return {
		trace_id: ctx.traceId,
		span_id: ctx.spanId,
		trace_flags: ctx.traceFlags.toString(16).padStart(2, '0')
	}
}

@Module({
	imports: [
		PinoLoggerModule.forRoot({
			pinoHttp: {
				genReqId: (): string => ulid(),
				customProps: (): Record<string, unknown> => ({}),
				mixin: traceMixin,
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
