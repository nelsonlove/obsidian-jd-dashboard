/**
 * LLM provider abstraction. Each provider implements model listing and
 * single-turn completion against its own REST API. Network calls go
 * through Obsidian's `requestUrl()` to bypass renderer-process CORS.
 */

import type { LlmProvider } from "./types";
import { anthropic } from "./anthropic";
import { openai } from "./openai";

export type ProviderId = "anthropic" | "openai";

const REGISTRY: Record<ProviderId, LlmProvider> = {
	anthropic,
	openai,
};

export function getProvider(id: ProviderId): LlmProvider {
	return REGISTRY[id];
}

export function listProviders(): { id: ProviderId; label: string }[] {
	return [
		{ id: "anthropic", label: "Anthropic" },
		{ id: "openai", label: "OpenAI" },
	];
}

export type { LlmProvider } from "./types";
