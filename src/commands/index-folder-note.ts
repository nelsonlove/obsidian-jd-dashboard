/**
 * Index a folder note: sync `jd-id` on the note + every sibling, then
 * rebuild the `## Contents (Obsidian)` section with bullet links to siblings.
 *
 * Mirrors the QuickAdd `jd-index-folder-note.js` script.
 */

import { type App, Notice, TFile } from "obsidian";
import { syncJdId, syncJdIds } from "../lib/sync-id";
import { getFolderNoteSiblings, updateFolderNote } from "../lib/folder-notes";

export async function indexFolderNote(app: App, file: TFile): Promise<void> {
	if (!file.parent || file.basename !== file.parent.name) {
		new Notice("This doesn't appear to be a folder note");
		return;
	}

	const allFiles = app.vault.getFiles().filter((f) => f.extension === "md");

	await syncJdId(app, file);
	const syncCount = await syncJdIds(app, getFolderNoteSiblings(allFiles, file));

	const updated = await updateFolderNote(app, file, allFiles);

	if (updated) {
		new Notice(`Updated folder note links (${syncCount} jd-ids synced)`);
	} else {
		new Notice(`No other notes in this folder (${syncCount} jd-ids synced)`);
	}
}
