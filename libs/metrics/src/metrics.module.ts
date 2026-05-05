import { Global, Module, OnApplicationBootstrap } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'

import { MetricsController } from './metrics.controller'
import { MetricsService } from './metrics.service'

type FastifyLikeInstance = {
	addHook: (event: 'onResponse', fn: (req: unknown, reply: unknown) => void) => void
}

type FastifyRequest = { method?: string; url?: string }
type FastifyReply = { statusCode?: number; elapsedTime?: number; getResponseTime?: () => number }

// Skip /metrics so prometheus's own scrape doesn't generate metrics about itself.
const shouldSample = (req: FastifyRequest): boolean => req.url !== '/metrics'

const elapsedMs = (rep: FastifyReply): number => {
	if (typeof rep.elapsedTime === 'number') return rep.elapsedTime
	if (typeof rep.getResponseTime === 'function') return rep.getResponseTime()
	return 0
}

@Global()
@Module({
	controllers: [MetricsController],
	providers: [MetricsService],
	exports: [MetricsService]
})
export class MetricsModule implements OnApplicationBootstrap {
	constructor(
		private readonly metrics: MetricsService,
		private readonly adapterHost: HttpAdapterHost
	) {}

	onApplicationBootstrap(): void {
		const fastify = this.adapterHost.httpAdapter?.getInstance() as FastifyLikeInstance | undefined
		if (!fastify?.addHook) return
		fastify.addHook('onResponse', (req: unknown, reply: unknown) => {
			const r = req as FastifyRequest
			const rep = reply as FastifyReply
			if (!shouldSample(r)) return
			this.metrics.httpRequestDurationMs
				.labels({ method: r.method ?? 'UNKNOWN', status_code: String(rep.statusCode ?? 0) })
				.observe(elapsedMs(rep))
		})
	}
}
