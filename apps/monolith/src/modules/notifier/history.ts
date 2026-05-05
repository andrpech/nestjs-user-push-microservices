export type HistoryEntryType =
	| 'CREATED'
	| 'CLAIMED_BY_TICK'
	| 'PUSH_ATTEMPT'
	| 'PUSH_SENT'
	| 'REDRIVEN_FROM_STUCK'
	| 'MANUAL_RETRY'

export type HistoryEntry = {
	at: string
	type: HistoryEntryType
	status?: number
	error?: string
}

export const historyEntry = (
	type: HistoryEntryType,
	extra: Partial<Pick<HistoryEntry, 'status' | 'error'>> = {}
): HistoryEntry => ({
	at: new Date().toISOString(),
	type,
	...extra
})

export const historyJson = (...entries: HistoryEntry[]): string => JSON.stringify(entries)
