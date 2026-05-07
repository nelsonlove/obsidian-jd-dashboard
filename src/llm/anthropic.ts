/**
 * Anthropic Messages API client. Uses Obsidian's `requestUrl()` to bypass
 * renderer-process CORS (api.anthropic.com doesn't allow browser origins).
 */

import { requestUrl } from "obsidian";
import type { LlmProvider } from "./types";

const API_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 1024;

export const anthropic: LlmProvider = {
	id: "anthropic",
	label: "Anthropic",

	async listModels(apiKey: string): Promise<string[]> {
		const res = await requestUrl({
			url: `${API_BASE}/models?limit=100`,
			method: "GET",
			headers: {
				"x-api-key": apiKey,
				"anthropic-version": ANTHROPIC_VERSION,
			},
			throw: false,
		});
		if (res.status >= 400) {
			throw new Error(`Anthropic ${res.status}: ${extractError(res.json)}`);
		}
		const data = res.json?.data ?? [];
		return data.map((m: { id: string }) => m.id);
	},

	async complete({ apiKey, model, prompt, maxTokens }): Promise<string> {
		const res = await requestUrl({
			url: `${API_BASE}/messages`,
			method: "POST",
			headers: {
				"x-api-key": apiKey,
				"anthropic-version": ANTHROPIC_VERSION,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model,
				max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
				messages: [{ role: "user", content: prompt }],
			}),
			throw: false,
		});
		if (res.status >= 400) {
			throw new Error(`Anthropic ${res.status}: ${extractError(res.json)}`);
		}
		const blocks = res.json?.content ?? [];
		const text = blocks
			.filter((b: { type: string }) => b.type === "text")
			.map((b: { text: string }) => b.text)
			.join("");
		return text.trim();
	},
};

function extractError(body: unknown): string {
	if (body && typeof body === "object" && "error" in body) {
		const err = (body as { error: { message?: string } }).error;
		if (err?.message) return err.message;
	}
	return "unknown error";
}
