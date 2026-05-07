/**
 * Vault-wide reindex: ensure folder notes for JD-named folders, rewrite all
 * category JDex (`XX.00`) files including the system index, refresh
 * `## Contents (Obsidian)` in every folder note, and sync `jd-id`
 * frontmatter across all JD-named files.
 *
 * Mirrors the QuickAdd `jd-index-vault.js` script.
 */

import { type App, Notice, TFile, moment } from "obsidian";
import { ensureFolderNotes, updateFolderNote } from "../lib/folder-notes";
import { syncJdIds } from "../lib/sync-id";
import {
	buildFrontmatter,
	buildLinks,
	getCategoryFiles,
	getCreatedDate,
	reindexCategory,
} from "../lib/category-index";

interface CategoryData {
	indexFile: TFile;
	folder: NonNullable<TFile["parent"]>;
	areaFolder: NonNullable<TFile["parent"]>["parent"];
	files: TFile[];
}

export async function indexVault(app: App): Promise<void> {
	// Use ISO-style T separator throughout. Space separator confuses some
	// YAML parsers (notably obsidian-linter's "Dedupe YAML Array Values"
	// rule, which mis-treats `2026-05-07 14:39` as a multi-line construct).
	const now = moment().format("YYYY-MM-DDTHH:mm");
	const modifiedNow = moment().format("YYYY-MM-DDTHH:mm");

	// 0. Auto-create folder notes for JD-named folders missing one.
	const folderNotesCreated = await ensureFolderNotes(app, now);

	// Refresh file list after potential creations.
	const allFiles = app.vault.getFiles().filter((f) => f.extension === "md");

	// 1. Rewrite all XX.00 category index files. Regex requires a real
	//    separator after XX.00 to avoid matching `XX.00+SUF.md`.
	const indexFiles = allFiles.filter((f) => /^\d{2}\.00(?:\s|\.|$)/.test(f.basename));
	let rewriteCount = 0;

	const categories = new Map<string, CategoryData>();
	for (const indexFile of indexFiles) {
		const m = indexFile.basename.match(/^(\d{2})/);
		if (!m || !indexFile.parent) continue;
		categories.set(m[1], {
			indexFile,
			folder: indexFile.parent,
			areaFolder: indexFile.parent.parent,
			files: getCategoryFiles(allFiles, m[1], indexFile.parent.path),
		});
	}

	for (const [prefix, cat] of categories) {
		if (prefix === "00") continue;
		await reindexCategory(app, cat.indexFile, allFiles, now, modifiedNow);
		rewriteCount++;
	}

	// Rewrite system index (00.00) — group by area.
	const systemCat = categories.get("00");
	if (systemCat) {
		const createdDate = await getCreatedDate(app, systemCat.indexFile, now);
		const title = "JDex for the system";

		const areas = new Map<string, Array<{ prefix: string } & CategoryData>>();
		for (const [prefix, cat] of categories) {
			const areaName = cat.areaFolder?.name ?? "(no area)";
			if (!areas.has(areaName)) areas.set(areaName, []);
			areas.get(areaName)!.push({ prefix, ...cat });
		}

		const sortedAreas = [...areas.entries()].sort((a, b) => a[0].localeCompare(b[0]));

		let body = "";
		for (const [areaName, areaCats] of sortedAreas) {
			body += `## ${areaName}\n\n`;
			areaCats.sort((a, b) => a.prefix.localeCompare(b.prefix));
			for (const cat of areaCats) {
				body += `### ${cat.folder.name}\n\n`;
				body += buildLinks(cat.files) + "\n\n";
			}
		}

		const content =
			buildFrontmatter(title, "00.00", createdDate, modifiedNow, systemCat.folder.name) +
			`\n# ${title}\n\n` +
			body +
			`^contents\n`;

		await app.vault.modify(systemCat.indexFile, content);
		rewriteCount++;
	}

	// 2. Update ## Contents (Obsidian) for every folder note.
	let folderNoteCount = 0;
	const folderNotes = allFiles.filter(
		(f) => f.parent && f.basename === f.parent.name && !/^\d{2}\.00\b/.test(f.basename)
	);
	for (const fn of folderNotes) {
		if (await updateFolderNote(app, fn, allFiles)) folderNoteCount++;
	}

	// 3. Sync jd-id frontmatter on all JD-named files.
	const syncCount = await syncJdIds(app, allFiles);

	new Notice(
		`Reindexed ${rewriteCount} indexes, ${folderNoteCount} folder notes updated, ` +
		`${folderNotesCreated} new folder notes created, ${syncCount} IDs synced`
	);
}

export async function indexCategory(app: App, indexFile: TFile): Promise<void> {
	if (!/^\d{2}\.00\b/.test(indexFile.basename)) {
		new Notice("Not a .00 index file");
		return;
	}

	const allFiles = app.vault.getFiles().filter((f) => f.extension === "md");
	const now = moment().format("YYYY-MM-DDTHH:mm");
	const modifiedNow = moment().format("YYYY-MM-DDTHH:mm");
	const prefix = indexFile.basename.match(/^(\d{2})/)![1];
	const folderPath = indexFile.parent?.path ?? "";

	await reindexCategory(app, indexFile, allFiles, now, modifiedNow);

	let folderNoteCount = 0;
	const folderNotes = allFiles.filter(
		(f) =>
			f.parent &&
			f.basename === f.parent.name &&
			!/^\d{2}\.00\b/.test(f.basename) &&
			f.parent.path.startsWith(folderPath)
	);
	for (const fn of folderNotes) {
		if (await updateFolderNote(app, fn, allFiles)) folderNoteCount++;
	}

	const catFiles = allFiles.filter((f) => f.parent?.path.startsWith(folderPath));
	const syncCount = await syncJdIds(app, catFiles);

	new Notice(`Reindexed ${prefix}, ${folderNoteCount} folder notes, ${syncCount} IDs synced`);
}
