import { Injectable } from '@nestjs/common'

import { Producer, RmqProducer } from '@app/rmq'
import type { IngestEvent } from '../dto/ingest.event'

// Publishes to the notifier's generic ingest exchange. The decorator carries
// a sensible default routing key (ingest.user-welcome); the publish-time
// override lets the same producer handle additional types as they're added
// without registering a new producer per type.
@Injectable()
@Producer({
	exchange: 'notifications.ingest',
	routingKey: 'ingest.user-welcome',
	exchangeType: 'topic'
})
export class IngestProducer extends RmqProducer<IngestEvent> {}
