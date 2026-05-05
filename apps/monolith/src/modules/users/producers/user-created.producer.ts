import { Injectable } from '@nestjs/common'

import { Producer, RmqProducer } from '@app/rmq'
import type { UserCreatedEvent } from '../dto/user-created.event'

@Injectable()
@Producer({
	exchange: 'users.events',
	routingKey: 'user.created',
	exchangeType: 'topic'
})
export class UserCreatedProducer extends RmqProducer<UserCreatedEvent> {}
