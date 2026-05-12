import { Injectable } from '@nestjs/common'

import { Producer, RmqProducer } from '@app/rmq'
import type { IngestEvent } from '../../notifier/dto/ingest.event'

// Used by the admin republish flow to drain the ingest DLQ back through the
// normal path. Duplicates the producer in the users app — each app owns its
// own outbound producer surface.
@Injectable()
@Producer({
	exchange: 'notifications.ingest',
	routingKey: 'ingest.user-welcome',
	exchangeType: 'topic'
})
export class IngestProducer extends RmqProducer<IngestEvent> {}
