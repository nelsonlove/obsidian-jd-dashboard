export interface LlmProvider {
	id: "anthropic" | "openai";
	label: string;

	/** GET /v1/models — returns the user-visible model IDs. */
	listModels(apiKey: string): Promise<string[]>;

	/** Single-turn completion. Throws on HTTP error. */
	complete(args: {
		apiKey: string;
		model: string;
		prompt: string;
		maxTokens?: number;
	}): Promise<string>;
}
