import { Injectable } from '@nestjs/common'

import { Producer, RmqProducer } from '@app/rmq'
import type { CronTick } from '../dto/cron-tick.dto'

@Injectable()
@Producer({
	exchange: 'system.cron',
	routingKey: 'cron.users',
	exchangeType: 'topic'
})
export class UsersCronProducer extends RmqProducer<CronTick> {}
