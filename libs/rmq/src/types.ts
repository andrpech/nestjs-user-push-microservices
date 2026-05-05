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
}
