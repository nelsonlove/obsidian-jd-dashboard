/**
 * Vault-wide reindex: ensure folder notes for JD-named folders, rewrite all
 * category JDex (`XX.00`) files including the system index, refresh
 * `## Contents (Obsidian)` in every folder note, and sync `jd-id`
 * frontmatter across all JD-named files.
 *
 * Per-iteration error isolation: one bad file (corrupt YAML, locked write,
 * etc.) doesn't kill the whole sweep. Failures are accumulated and surfaced
 * in the final Notice with a console-warn for paths.
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

interface Failures {
	indexes: { path: string; error: string }[];
	folderNotes: { path: string; error: string }[];
}

export async function indexVault(app: App): Promise<void> {
	// Use ISO-style T separator throughout. Space separator confuses some
	// YAML parsers (notably obsidian-linter's "Dedupe YAML Array Values"
	// rule, which mis-treats `2026-05-07 14:39` as a multi-line construct).
	const now = moment().format("YYYY-MM-DDTHH:mm");
	const modifiedNow = now;

	const failures: Failures = { indexes: [], folderNotes: [] };

	// 0. Auto-create folder notes for JD-named folders missing one.
	const folderResult = await ensureFolderNotes(app, now);

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
			files: getCategoryFiles(allFiles, m[1], indexFile.parent.path, indexFile.path),
		});
	}

	for (const [prefix, cat] of categories) {
		if (prefix === "00") continue;
		try {
			await reindexCategory(app, cat.indexFile, allFiles, now, modifiedNow);
			rewriteCount++;
		} catch (e) {
			failures.indexes.push({ path: cat.indexFile.path, error: (e as Error).message });
			console.warn("[jd] reindexCategory failed", cat.indexFile.path, e);
		}
	}

	// Rewrite system index (00.00) — group by area.
	const systemCat = categories.get("00");
	if (systemCat) {
		try {
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
				body;

			await app.vault.modify(systemCat.indexFile, content);
			rewriteCount++;
		} catch (e) {
			failures.indexes.push({ path: systemCat.indexFile.path, error: (e as Error).message });
			console.warn("[jd] system reindex failed", systemCat.indexFile.path, e);
		}
	}

	// 2. Update ## Contents (Obsidian) for every folder note.
	let folderNoteCount = 0;
	const folderNotes = allFiles.filter(
		(f) => f.parent && f.basename === f.parent.name && !/^\d{2}\.00\b/.test(f.basename)
	);
	for (const fn of folderNotes) {
		try {
			if (await updateFolderNote(app, fn, allFiles)) folderNoteCount++;
		} catch (e) {
			failures.folderNotes.push({ path: fn.path, error: (e as Error).message });
			console.warn("[jd] updateFolderNote failed", fn.path, e);
		}
	}

	// 3. Sync jd-id frontmatter on all JD-named files.
	const syncResult = await syncJdIds(app, allFiles);

	const errCount =
		failures.indexes.length +
		failures.folderNotes.length +
		folderResult.failures.length +
		syncResult.failures.length;
	const errPart = errCount > 0 ? ` · ${errCount} errors (see console)` : "";
	new Notice(
		`Reindexed ${rewriteCount} indexes, ${folderNoteCount} folder notes updated, ` +
		`${folderResult.created} new folder notes created, ${syncResult.synced} IDs synced${errPart}`
	);
	if (errCount > 0) {
		console.warn("[jd] indexVault errors:", {
			indexes: failures.indexes,
			folderNotes: failures.folderNotes,
			ensureFolderNotes: folderResult.failures,
			syncJdIds: syncResult.failures,
		});
	}
}

export async function indexCategory(app: App, indexFile: TFile): Promise<void> {
	if (!/^\d{2}\.00\b/.test(indexFile.basename)) {
		new Notice("Not a .00 index file");
		return;
	}

	const allFiles = app.vault.getFiles().filter((f) => f.extension === "md");
	const now = moment().format("YYYY-MM-DDTHH:mm");
	const modifiedNow = now;
	const prefix = indexFile.basename.match(/^(\d{2})/)![1];
	const folderPath = indexFile.parent?.path ?? "";

	const failures: { path: string; error: string }[] = [];

	try {
		await reindexCategory(app, indexFile, allFiles, now, modifiedNow);
	} catch (e) {
		failures.push({ path: indexFile.path, error: (e as Error).message });
		console.warn("[jd] reindexCategory failed", indexFile.path, e);
	}

	let folderNoteCount = 0;
	const folderNotes = allFiles.filter(
		(f) =>
			f.parent &&
			f.basename === f.parent.name &&
			!/^\d{2}\.00\b/.test(f.basename) &&
			f.parent.path.startsWith(folderPath)
	);
	for (const fn of folderNotes) {
		try {
			if (await updateFolderNote(app, fn, allFiles)) folderNoteCount++;
		} catch (e) {
			failures.push({ path: fn.path, error: (e as Error).message });
			console.warn("[jd] updateFolderNote failed", fn.path, e);
		}
	}

	const catFiles = allFiles.filter((f) => f.parent?.path.startsWith(folderPath));
	const syncResult = await syncJdIds(app, catFiles);

	const errCount = failures.length + syncResult.failures.length;
	const errPart = errCount > 0 ? ` · ${errCount} errors (see console)` : "";
	new Notice(
		`Reindexed ${prefix}, ${folderNoteCount} folder notes, ${syncResult.synced} IDs synced${errPart}`
	);
	if (errCount > 0) {
		console.warn("[jd] indexCategory errors:", { failures, syncJdIds: syncResult.failures });
	}
}
