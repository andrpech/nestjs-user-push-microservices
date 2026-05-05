import 'reflect-metadata'

export const CONSUMER_METADATA_KEY = Symbol('rmq:consumer')

export type ConsumerMetadata = {
	queue: string
	prefetch?: number
}

export const Consumer =
	(meta: ConsumerMetadata): ClassDecorator =>
	(target) => {
		Reflect.defineMetadata(CONSUMER_METADATA_KEY, meta, target)
	}

export const getConsumerMetadata = (target: object): ConsumerMetadata | undefined =>
	Reflect.getMetadata(CONSUMER_METADATA_KEY, target.constructor) as ConsumerMetadata | undefined
