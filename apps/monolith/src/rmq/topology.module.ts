import { Module } from '@nestjs/common'

import { TopologyService } from './topology.service'

@Module({
	providers: [TopologyService]
})
export class TopologyModule {}
