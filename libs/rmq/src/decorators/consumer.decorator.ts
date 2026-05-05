import 'reflect-metadata'

import type { ExchangeType } from './producer.decorator'

export const CONSUMER_METADATA_KEY = Symbol('rmq:consumer')

export type ConsumerBinding = {
	exchange: string
	routingKey: string
	exchangeType?: ExchangeType
}

export type ConsumerMetadata = {
	queue: string
	prefetch?: number
	bindings?: ConsumerBinding[]
	queueArgs?: Record<string, unknown>
}

export const Consumer =
	(meta: ConsumerMetadata): ClassDecorator =>
	(target) => {
		Reflect.defineMetadata(CONSUMER_METADATA_KEY, meta, target)
	}

export const getConsumerMetadata = (target: object): ConsumerMetadata | undefined =>
	Reflect.getMetadata(CONSUMER_METADATA_KEY, target.constructor) as ConsumerMetadata | undefined
