export type PrismaQueryEvent = {
	model: string
	operation: string
	durationMs: number
}

export type QueryObserver = (event: PrismaQueryEvent) => void
