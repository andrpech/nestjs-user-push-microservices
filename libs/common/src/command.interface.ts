export interface Command<I, O = void> {
	execute(input: I): Promise<O>
}
