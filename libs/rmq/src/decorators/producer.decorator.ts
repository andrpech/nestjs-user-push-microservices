import 'reflect-metadata'

export const PRODUCER_METADATA_KEY = Symbol('rmq:producer')

export type ExchangeType = 'topic' | 'direct' | 'fanout' | 'headers'

export type ProducerMetadata = {
	exchange: string
	routingKey: string
	exchangeType?: ExchangeType
}

export const Producer =
	(meta: ProducerMetadata): ClassDecorator =>
	(target) => {
		Reflect.defineMetadata(PRODUCER_METADATA_KEY, meta, target)
	}

export const getProducerMetadata = (target: object): ProducerMetadata | undefined =>
	Reflect.getMetadata(PRODUCER_METADATA_KEY, target.constructor) as ProducerMetadata | undefined
