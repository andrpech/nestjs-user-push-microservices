import { ulid as ulidImpl } from 'ulid'

export const ulid = (): string => ulidImpl()
