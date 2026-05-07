/**
 * `jd-id` frontmatter sync from filename. The on-save normalizer handles
 * single-file sync inline; these helpers exist for batch operations
 * (index-vault, index-folder-note) that need to fix many files at once.
 */

import type { App, TFile } from "obsidian";

const JD_ID_PATTERN = /^(\d{2}\.\d{2})\b/;

export async function syncJdId(app: App, file: TFile): Promise<boolean> {
	const match = file.basename.match(JD_ID_PATTERN);
	if (!match) return false;

	const jdId = match[1];
	const fm = app.metadataCache.getFileCache(file)?.frontmatter;
	if (fm?.["jd-id"] === jdId) return false;

	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		frontmatter["jd-id"] = jdId;
	});
	return true;
}

export async function syncJdIds(app: App, files: TFile[]): Promise<number> {
	let count = 0;
	for (const file of files) {
		if (await syncJdId(app, file)) count++;
	}
	return count;
}
