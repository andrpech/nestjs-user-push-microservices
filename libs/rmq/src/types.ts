import type { Message } from 'amqplib'

export type ConsumerCtx = {
	messageId: string | undefined
	deathCount: number
	headers: Record<string, unknown>
	rawMessage: Message
}

export type PublishOpts = {
	expiration?: number
	headers?: Record<string, unknown>
	mandatory?: boolean
	messageId?: string
	// Per-publish override for the decorator's routingKey. Used by multi-type
	// producers (e.g. ingest.user-welcome vs ingest.password-changed) that share
	// a single exchange but differ per call.
	routingKey?: string
}
