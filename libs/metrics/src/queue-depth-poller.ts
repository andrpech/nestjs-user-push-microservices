import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import type { Gauge } from 'prom-client'

export type QueueDepthPollerConfig = {
	managementUrl: string
	queues: readonly string[]
	intervalMs?: number
	gauge: Gauge<'queue'>
}

const DEFAULT_INTERVAL_MS = 10_000

type ParsedUrl = {
	url: string
	authHeader?: string
}

// Native fetch refuses URLs with embedded `user:pass@host` credentials, so we
// strip them out and rebuild Authorization: Basic.
const parseManagementUrl = (raw: string): ParsedUrl => {
	const trimmed = raw.replace(/\/$/, '')
	const u = new URL(trimmed)
	if (!u.username) {
		return { url: u.toString().replace(/\/$/, '') }
	}
	const creds = `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`
	const authHeader = `Basic ${Buffer.from(creds).toString('base64')}`
	u.username = ''
	u.password = ''
	return { url: u.toString().replace(/\/$/, ''), authHeader }
}

// Polls the RabbitMQ management HTTP API at a fixed interval and pushes each
// queue's depth into the supplied prom-client Gauge.
export class QueueDepthPoller implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(QueueDepthPoller.name)
	private timer: NodeJS.Timeout | undefined
	private readonly parsed: ParsedUrl

	constructor(private readonly config: QueueDepthPollerConfig) {
		this.parsed = parseManagementUrl(config.managementUrl)
	}

	onModuleInit(): void {
		const interval = this.config.intervalMs ?? DEFAULT_INTERVAL_MS
		this.timer = setInterval(() => void this.poll(), interval)
		void this.poll()
	}

	onModuleDestroy(): void {
		if (this.timer) clearInterval(this.timer)
	}

	private async poll(): Promise<void> {
		const headers: Record<string, string> = {}
		if (this.parsed.authHeader) headers.Authorization = this.parsed.authHeader

		await Promise.all(
			this.config.queues.map(async (q) => {
				try {
					const res = await fetch(`${this.parsed.url}/api/queues/%2F/${encodeURIComponent(q)}`, {
						headers
					})
					if (!res.ok) {
						this.config.gauge.labels({ queue: q }).set(0)
						return
					}
					const data = (await res.json()) as { messages?: number }
					this.config.gauge.labels({ queue: q }).set(data.messages ?? 0)
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					this.logger.warn({ error: message, queue: q }, 'queue depth poll failed')
				}
			})
		)
	}
}
