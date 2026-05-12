import { Injectable, Logger } from '@nestjs/common'
import type { ChannelWrapper } from 'amqp-connection-manager'
import type { GetMessage } from 'amqplib'

import { Command } from '@app/common'
import { RmqConnection } from '@app/rmq'
import { IngestEventSchema } from '../../notifier/dto/ingest.event'
import { IngestProducer } from '../producers/ingest.producer'

const DLQ = 'notifier.ingest.dlq'
const DLX = 'notifications.dlx'
const DLX_ROUTING_KEY = 'ingest'

const parseFailed = Symbol('parseFailed')

const safeJsonParse = (raw: string): unknown => {
	try {
		return JSON.parse(raw)
	} catch {
		return parseFailed
	}
}

const routingKeyFor = (type: string): string => `ingest.${type.toLowerCase().replace(/_/g, '-')}`

export type RepublishInput = { ids?: string[] }
export type RepublishResult = { republished: number; failed: number; skipped: number }

// Drains the ingest DLQ, optionally filtering by sourceEventId from the
// payload, and republishes matched messages back to notifications.ingest with
// a per-type routing key derived from the envelope. Unmatched and invalid
// messages re-publish back through the DLX (recreating them in the DLQ tail)
// so a single pass never revisits messages — rabbitmq's `nack(requeue=true)`
// returns to the head and would loop us.

// eslint-disable no-await-in-loop -- the drain is fundamentally sequential:
// each `get` depends on the previous iteration's ack/publish having committed.
// Parallelizing would re-introduce the head-of-queue revisit issue.
@Injectable()
export class RepublishInboxDlqCommand implements Command<RepublishInput, RepublishResult> {
	private readonly logger = new Logger(RepublishInboxDlqCommand.name)

	constructor(
		private readonly conn: RmqConnection,
		private readonly producer: IngestProducer
	) {}

	async execute({ ids }: RepublishInput): Promise<RepublishResult> {
		const filter = ids ? new Set(ids) : null
		const drainChannel: ChannelWrapper = this.conn.createChannel()
		await drainChannel.waitForConnect()

		const result: RepublishResult = { republished: 0, failed: 0, skipped: 0 }

		const requeueViaDlx = async (msg: GetMessage): Promise<void> => {
			await drainChannel.publish(DLX, DLX_ROUTING_KEY, msg.content, {
				persistent: true,
				contentType: msg.properties.contentType ?? 'application/json',
				messageId: msg.properties.messageId,
				timestamp: msg.properties.timestamp,
				headers: msg.properties.headers
			})
			await drainChannel.ack(msg)
		}

		try {
			// Snapshot queue depth — we drain at most this many messages.
			const initial = (await drainChannel.checkQueue(DLQ)) as { messageCount: number }
			let remaining = initial.messageCount
			while (remaining-- > 0) {
				const msg = (await drainChannel.get(DLQ, { noAck: false })) as GetMessage | false
				if (!msg) break

				const { messageId } = msg.properties
				const raw = msg.content?.toString?.() ?? ''
				const json = safeJsonParse(raw)

				if (json === parseFailed) {
					this.logger.warn({ messageId }, 'DLQ message could not be JSON-parsed — re-DLX-ing')
					await requeueViaDlx(msg)
					result.failed++
				} else {
					const parse = IngestEventSchema.safeParse(json)
					if (!parse.success) {
						this.logger.warn(
							{ messageId, error: parse.error.message },
							'DLQ message has invalid payload — re-DLX-ing'
						)
						await requeueViaDlx(msg)
						result.failed++
					} else if (filter && !filter.has(parse.data.sourceEventId)) {
						// `ids` filters against sourceEventId — the natural admin-facing key
						// for an ingest event. AMQP message_id is a separate concept and not
						// always set (e.g. messages planted via the management UI).
						await requeueViaDlx(msg)
						result.skipped++
					} else {
						try {
							await this.producer.publish(parse.data, {
								messageId: messageId ?? parse.data.sourceEventId,
								routingKey: routingKeyFor(parse.data.type)
							})
							await drainChannel.ack(msg)
							result.republished++
						} catch (error) {
							this.logger.warn(
								{
									messageId,
									error: error instanceof Error ? error.message : String(error)
								},
								'republish publish failed — re-DLX-ing'
							)
							await requeueViaDlx(msg)
							result.failed++
						}
					}
				}
			}
		} finally {
			await drainChannel.close()
		}

		return result
	}
}
