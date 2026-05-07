/**
 * Standard-zeros (`XX.00`–`XX.09`) generation for JD categories.
 * Mirrors the QuickAdd `jd-lib.js` shape so behavior stays consistent.
 */

import type { App, TFolder } from "obsidian";

export interface ZeroSpec {
	id: string;
	name: string;
	tag: string;
	hasDir: boolean;
}

export function suffixFor(prefix: string): string {
	return prefix === "00" ? "for the system" : `for category ${prefix}`;
}

export function standardZeros(prefix: string, suffix: string): ZeroSpec[] {
	return [
		{ id: "00", name: `JDex ${suffix}`, tag: "jd/index", hasDir: false },
		{ id: "01", name: `Inbox ${suffix}`, tag: "jd/inbox", hasDir: true },
		{ id: "02", name: `Task & project management ${suffix}`, tag: "jd/tasks", hasDir: false },
		{ id: "03", name: `Templates ${suffix}`, tag: "jd/templates", hasDir: true },
		{ id: "04", name: `Links ${suffix}`, tag: "jd/links", hasDir: false },
		{ id: "05", name: `Conventions & policies ${suffix}`, tag: "jd/policies", hasDir: false },
		{ id: "06", name: `Knowledge base ${suffix}`, tag: "jd/knowledge-base", hasDir: true },
		{ id: "08", name: `Someday ${suffix}`, tag: "jd/someday", hasDir: false },
		{ id: "09", name: `Archive ${suffix}`, tag: "jd/archive", hasDir: true },
	];
}

export function buildZeroFrontmatter(zero: ZeroSpec, prefix: string, folderName: string, now: string): string {
	const aliases =
		zero.id === "00"
			? `  - ${zero.name}\n  - ${folderName}`
			: `  - ${zero.name}`;

	return `---
title: ${zero.name}
jd-id: "${prefix}.${zero.id}"
created: ${now}
modified: ${now}
tags:
  - ${zero.tag}
aliases:
${aliases}
linter-yaml-title-alias: ${zero.name}
---

# ${zero.name}

`;
}

/**
 * Folder may not exist yet — pass an object with at least `path` and `name`.
 * Vault will create folders implicitly when the first file is written.
 */
export interface FolderLike {
	path: string;
	name: string;
}

export async function createStandardZeros(
	app: App,
	folder: FolderLike,
	prefix: string,
	now: string
): Promise<{ created: number; skipped: number }> {
	const suffix = suffixFor(prefix);
	const zeros = standardZeros(prefix, suffix);
	let created = 0;
	let skipped = 0;

	for (const zero of zeros) {
		const basename = `${prefix}.${zero.id} ${zero.name}`;
		const filepath = zero.hasDir
			? `${folder.path}/${basename}/${basename}.md`
			: `${folder.path}/${basename}.md`;

		if (app.vault.getAbstractFileByPath(filepath)) {
			skipped++;
			continue;
		}

		await app.vault.create(filepath, buildZeroFrontmatter(zero, prefix, folder.name, now));
		created++;
	}

	return { created, skipped };
}
