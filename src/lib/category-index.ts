/**
 * Vault-based category index builder. Walks vault files (not JDex YAML)
 * to rebuild `XX.00 JDex for category XX.md` files. Used by index-folder-note,
 * index-category, and index-vault commands.
 *
 * Distinct from `render-jdex.ts` which builds from `jd-index.yaml`. This
 * one is for users whose source-of-truth is the vault structure itself.
 */

import { type App, TFile } from "obsidian";

export async function getCreatedDate(app: App, file: TFile, fallback: string): Promise<string> {
	try {
		const existing = await app.vault.read(file);
		const match = existing.match(/^created:\s*(.+)$/m);
		if (match) return match[1].trim();
	} catch {
		// new or unreadable
	}
	return fallback;
}

export function buildFrontmatter(
	title: string,
	jdId: string,
	created: string,
	modified: string,
	folderName: string
): string {
	return `---
title: ${title}
jd-id: "${jdId}"
created: ${created}
modified: ${modified}
tags:
  - jd/index
aliases:
  - ${title}
  - ${folderName}
linter-yaml-title-alias: ${title}
---
`;
}

export function buildLinks(files: TFile[]): string {
	return files
		.map((f) => {
			const bn = f.basename;
			const subMatch = bn.match(/^(\d{5,})\.00\s+(.+)$/);
			if (subMatch) {
				return `- [[${bn}|${subMatch[1]} ${subMatch[2]}]]`;
			}
			return `- [[${bn}]]`;
		})
		.join("\n");
}

export function getCategoryFiles(allFiles: TFile[], prefix: string, folderPath: string): TFile[] {
	return allFiles
		.filter((f) => {
			if (!f.basename.startsWith(prefix)) return false;
			if (!f.parent || !f.parent.path.startsWith(folderPath)) return false;
			return true;
		})
		.sort((a, b) => a.basename.localeCompare(b.basename));
}

export async function reindexCategory(
	app: App,
	indexFile: TFile,
	allFiles: TFile[],
	now: string,
	modifiedNow: string
): Promise<void> {
	const prefixMatch = indexFile.basename.match(/^(\d{2})/);
	if (!prefixMatch) return;
	const prefix = prefixMatch[1];
	const folder = indexFile.parent;
	if (!folder) return;
	const catFiles = getCategoryFiles(allFiles, prefix, folder.path);
	const createdDate = await getCreatedDate(app, indexFile, now);
	const title = `JDex for category ${prefix}`;

	const content =
		buildFrontmatter(title, `${prefix}.00`, createdDate, modifiedNow, folder.name) +
		`\n# ${title}\n\n` +
		buildLinks(catFiles) +
		`\n`;

	await app.vault.modify(indexFile, content);
}
