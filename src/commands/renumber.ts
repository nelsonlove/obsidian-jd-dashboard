/**
 * Renumber an active JD note to a new ID. If the target ID is already
 * occupied, prompts whether to auto-displace the occupant (next available
 * ID in its category) or to enter a manual displacement ID. Then renames
 * both notes in the right order so the slot opens before the source moves.
 *
 * Renames the .md file and the parent folder (if it's a folder cover note),
 * and updates `jd-id` frontmatter. Wikilinks auto-update via
 * `app.fileManager.renameFile`.
 */

import { type App, Notice, TFile, TFolder } from "obsidian";
import { confirmPrompt, inputPrompt } from "../lib/prompts";

const ID_RE = /^(\d{2}\.\d{2})$/;
const FN_RE = /^(\d{2}\.\d{2})\s+(.+)$/;

export async function renumberCommand(app: App, file: TFile): Promise<void> {
	const fnMatch = file.basename.match(FN_RE);
	if (!fnMatch) {
		new Notice("Active file's name doesn't start with a JD ID (e.g. '06.13 Foo')");
		return;
	}
	const currentId = fnMatch[1];

	const newId = await inputPrompt(app, `Renumber ${currentId} → ?`, "XX.YY", currentId);
	if (!newId) return;
	const target = newId.trim();
	if (!ID_RE.test(target)) {
		new Notice(`Invalid ID: ${newId}`);
		return;
	}
	if (target === currentId) {
		new Notice("New ID equals current — nothing to do");
		return;
	}

	const occupant = findByJdId(app, target, file);
	let displaceId: string | null = null;

	if (occupant) {
		const auto = await confirmPrompt(
			app,
			`${target} is in use by "${occupant.basename}"`,
			"Auto-displace the existing note to the next available ID in its category?"
		);
		if (auto) {
			displaceId = nextAvailableId(app, target.slice(0, 2));
			if (!displaceId) {
				new Notice("No free IDs available in that category");
				return;
			}
		} else {
			const manual = await inputPrompt(app, `New ID for "${occupant.basename}"`, "XX.YY");
			if (!manual) return;
			if (!ID_RE.test(manual.trim())) {
				new Notice(`Invalid displacement ID: ${manual}`);
				return;
			}
			displaceId = manual.trim();
			if (findByJdId(app, displaceId, occupant)) {
				new Notice(`${displaceId} is also taken — pick a free ID and try again`);
				return;
			}
		}
		await renumber(app, occupant, displaceId);
	}

	await renumber(app, file, target);

	new Notice(
		occupant
			? `Renumbered ${currentId} → ${target}; displaced → ${displaceId}`
			: `Renumbered ${currentId} → ${target}`
	);
}

// ── Lookups ─────────────────────────────────────────────────────

function findByJdId(app: App, id: string, exclude: TFile): TFile | null {
	for (const f of app.vault.getMarkdownFiles()) {
		if (f.path === exclude.path) continue;
		const fm = app.metadataCache.getFileCache(f)?.frontmatter;
		if (fm && fm["jd-id"] === id) return f;
		if (f.basename.startsWith(`${id} `)) return f;
	}
	return null;
}

function nextAvailableId(app: App, categoryNum: string): string | null {
	const used = new Set<string>();
	for (const f of app.vault.getMarkdownFiles()) {
		const fm = app.metadataCache.getFileCache(f)?.frontmatter;
		const id = fm?.["jd-id"];
		if (typeof id === "string" && id.startsWith(`${categoryNum}.`)) used.add(id);
		const m = f.basename.match(FN_RE);
		if (m && m[1].startsWith(`${categoryNum}.`)) used.add(m[1]);
	}
	for (let i = 10; i <= 99; i++) {
		const candidate = `${categoryNum}.${String(i).padStart(2, "0")}`;
		if (!used.has(candidate)) return candidate;
	}
	return null;
}

// ── Renaming ────────────────────────────────────────────────────

async function renumber(app: App, file: TFile, newId: string): Promise<void> {
	const m = file.basename.match(FN_RE);
	if (!m) throw new Error(`Refusing to rename ${file.path} — no JD ID prefix in filename`);
	const title = m[2];
	const newBasename = `${newId} ${title}`;
	const parent = file.parent;
	const isCoverNote = parent && file.basename === parent.name;

	if (isCoverNote && parent) {
		const grandparentPath = parent.parent && parent.parent.path !== "/" ? parent.parent.path : "";
		const newFolderPath = grandparentPath ? `${grandparentPath}/${newBasename}` : newBasename;
		await app.fileManager.renameFile(parent as TFolder, newFolderPath);
		await app.fileManager.renameFile(file, `${newFolderPath}/${newBasename}.md`);
	} else {
		const parentPath = parent && parent.path !== "/" ? parent.path : "";
		const newPath = parentPath ? `${parentPath}/${newBasename}.md` : `${newBasename}.md`;
		await app.fileManager.renameFile(file, newPath);
	}

	await app.fileManager.processFrontMatter(file, (fm) => {
		fm["jd-id"] = newId;
	});
}
