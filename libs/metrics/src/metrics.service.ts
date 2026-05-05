import { Injectable } from '@nestjs/common'
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client'

import type { PrismaQueryEvent } from './types'

// Single Registry per process. All custom metrics + default Node.js process
// metrics (`process_cpu_seconds_total`, `process_resident_memory_bytes`, etc.)
// are registered here. Apps that don't observe a particular custom metric just
// expose it at zero — Prometheus is fine with that.
@Injectable()
export class MetricsService {
	readonly registry: Registry

	readonly notificationsCreatedTotal: Counter<string>
	readonly notificationsSentTotal: Counter<string>
	readonly notificationsFailedTotal: Counter<'reason'>
	readonly notificationRedriveCount: Histogram<string>
	readonly prismaRequestDurationMs: Histogram<'model' | 'operation'>
	readonly rmqQueueDepth: Gauge<'queue'>
	readonly httpRequestDurationMs: Histogram<'method' | 'status_code'>

	constructor() {
		this.registry = new Registry()
		collectDefaultMetrics({ register: this.registry })

		this.notificationsCreatedTotal = new Counter({
			name: 'notifications_created_total',
			help: 'Notifications inserted (excludes dedupe hits on userId @unique)',
			registers: [this.registry]
		})

		this.notificationsSentTotal = new Counter({
			name: 'notifications_sent_total',
			help: 'Notifications transitioned to terminal SENT',
			registers: [this.registry]
		})

		this.notificationsFailedTotal = new Counter({
			name: 'notifications_failed_total',
			help: 'Notifications that ended in terminal FAILED, by reason',
			labelNames: ['reason'] as const,
			registers: [this.registry]
		})

		this.notificationRedriveCount = new Histogram({
			name: 'notification_redrive_count',
			help: 'Distribution of redrive counts at the time a notification is recovered or terminated',
			buckets: [0, 1, 2, 3, 4, 5, 10],
			registers: [this.registry]
		})

		this.prismaRequestDurationMs = new Histogram({
			name: 'prisma_request_duration_ms',
			help: 'Prisma query duration by model + operation',
			labelNames: ['model', 'operation'] as const,
			buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000],
			registers: [this.registry]
		})

		this.rmqQueueDepth = new Gauge({
			name: 'rmq_queue_depth',
			help: 'Current depth (messages) of an RMQ queue, polled from the management API',
			labelNames: ['queue'] as const,
			registers: [this.registry]
		})

		this.httpRequestDurationMs = new Histogram({
			name: 'http_request_duration_ms',
			help: 'HTTP request duration by method + status code',
			labelNames: ['method', 'status_code'] as const,
			buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000],
			registers: [this.registry]
		})
	}

	observePrismaQuery = (event: PrismaQueryEvent): void => {
		this.prismaRequestDurationMs
			.labels({ model: event.model, operation: event.operation })
			.observe(event.durationMs)
	}

	metrics(): Promise<string> {
		return this.registry.metrics()
	}

	contentType(): string {
		return this.registry.contentType
	}
}
