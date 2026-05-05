import { Injectable } from '@nestjs/common'

import { Producer, RmqProducer } from '@app/rmq'
import type { UserCreatedEvent } from '../../notifier/dto/user-created.event'

// Duplicates the producer in the users app — the admin module uses it to
// republish messages drained from the inbox DLQ back through the normal path.
@Injectable()
@Producer({
	exchange: 'users.events',
	routingKey: 'user.created',
	exchangeType: 'topic'
})
export class UserCreatedProducer extends RmqProducer<UserCreatedEvent> {}
