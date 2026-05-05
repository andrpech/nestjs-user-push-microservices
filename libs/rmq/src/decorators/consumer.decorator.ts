import 'reflect-metadata'

import type { ExchangeType } from './producer.decorator'

export const CONSUMER_METADATA_KEY = Symbol('rmq:consumer')

export type ConsumerBinding = {
	exchange: string
	routingKey: string
	exchangeType?: ExchangeType
}

// When set, the base consumer publishes the original message to this exchange
// (with the original routing key) and acks once `x-death[queue].count` reaches
// `maxAttempts - 1` — covers both zod parse errors and handle() throws.
export type ConsumerDlq = {
	exchange: string
	routingKey: string
	maxAttempts: number
}

export type ConsumerMetadata = {
	queue: string
	prefetch?: number
	bindings?: ConsumerBinding[]
	queueArgs?: Record<string, unknown>
	dlq?: ConsumerDlq
}

export const Consumer =
	(meta: ConsumerMetadata): ClassDecorator =>
	(target) => {
		Reflect.defineMetadata(CONSUMER_METADATA_KEY, meta, target)
	}

export const getConsumerMetadata = (target: object): ConsumerMetadata | undefined =>
	Reflect.getMetadata(CONSUMER_METADATA_KEY, target.constructor) as ConsumerMetadata | undefined
