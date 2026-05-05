import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { Resource } from '@opentelemetry/resources'
import { NodeSDK } from '@opentelemetry/sdk-node'
import {
	SEMRESATTRS_SERVICE_NAME,
	SEMRESATTRS_SERVICE_VERSION
} from '@opentelemetry/semantic-conventions'

// Side-effect import — apps do `import '@app/tracing/register'` as the first
// line of their main.ts so SDK hooks load before http/fastify/pg/amqplib.
//
// Reads OTEL_EXPORTER_OTLP_ENDPOINT (default http://jaeger:4318) and
// OTEL_SERVICE_NAME (required). Set OTEL_LOG_LEVEL=debug to debug.

if (process.env.OTEL_LOG_LEVEL === 'debug') {
	diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG)
}

const serviceName = process.env.OTEL_SERVICE_NAME
if (!serviceName) {
	console.warn('[@app/tracing] OTEL_SERVICE_NAME not set — falling back to "unknown_service"')
}

const exporterUrl =
	process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
	(process.env.OTEL_EXPORTER_OTLP_ENDPOINT
		? `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '')}/v1/traces`
		: 'http://jaeger:4318/v1/traces')

const sdk = new NodeSDK({
	resource: new Resource({
		[SEMRESATTRS_SERVICE_NAME]: serviceName ?? 'unknown_service',
		[SEMRESATTRS_SERVICE_VERSION]: process.env.npm_package_version ?? '0.1.0'
	}),
	traceExporter: new OTLPTraceExporter({ url: exporterUrl }),
	instrumentations: [
		getNodeAutoInstrumentations({
			'@opentelemetry/instrumentation-fs': { enabled: false },
			'@opentelemetry/instrumentation-dns': { enabled: false },
			'@opentelemetry/instrumentation-net': { enabled: false },
			'@opentelemetry/instrumentation-http': {
				ignoreIncomingRequestHook: (req): boolean => {
					const url = req.url ?? ''
					return url === '/metrics' || url === '/lhealth' || url === '/rhealth'
				}
			}
		})
	]
})

sdk.start()

const shutdown = (): void => {
	sdk
		.shutdown()
		.catch((error: unknown) => console.warn('[@app/tracing] shutdown error', error))
		.finally(() => process.exit(0))
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
