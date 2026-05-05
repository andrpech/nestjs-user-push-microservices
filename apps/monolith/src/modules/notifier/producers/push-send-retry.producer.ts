import { Injectable } from '@nestjs/common'

import { Producer, RmqProducer } from '@app/rmq'
import type { PushSendEvent } from '../dto/push-send.event'

@Injectable()
@Producer({
	exchange: 'notifications.retry.work',
	routingKey: 'push.send',
	exchangeType: 'topic'
})
export class PushSendRetryProducer extends RmqProducer<PushSendEvent> {}
