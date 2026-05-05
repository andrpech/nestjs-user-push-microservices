import { Injectable } from '@nestjs/common'

import { Producer, RmqProducer } from '@app/rmq'
import type { PushSendEvent } from '../dto/push-send.event'

@Injectable()
@Producer({
	exchange: 'notifications.work',
	routingKey: 'push.send',
	exchangeType: 'topic'
})
export class PushSendProducer extends RmqProducer<PushSendEvent> {}
