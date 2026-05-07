/**
 * Template-driven note creation commands.
 *
 * Three commands operate on the JD category derived from the active file:
 *   - newStandardZeroFromTemplate: pick a standard zero (00–08), create that one.
 *   - newGenericIdFromTemplate:    prompt for ID + title, create XX.YY Name.md.
 *   - newStemFromTemplate:         pick a stem code, prompt for name, create XX.00+CODE Name.md.
 *
 * All three read templates from settings.templatesFolder.
 */

import { type App, Notice, SuggestModal, TFile, TFolder } from "obsidian";
import type { JDSettings } from "../settings";
import { inputPrompt } from "../lib/prompts";
import { standardZeros, suffixFor, type ZeroSpec } from "../lib/standard-zeros";
import {
	buildContext,
	createFromTemplate,
	destPathForGenericId,
	destPathForStem,
	destPathForZero,
	findGenericTemplate,
	findStemTemplate,
	findZeroTemplate,
	listStemCodes,
	listTemplates,
} from "../lib/templates";

// ── Category detection ───────────────────────────────────────────

interface CategoryContext {
	folder: TFolder;
	prefix: string;
	folderName: string;
}

function findCategoryFolder(file: TFile): CategoryContext | null {
	let cur: TFolder | null = file.parent;
	while (cur && cur.path !== "/") {
		const m = cur.name.match(/^(\d{2})\s/);
		if (m) {
			return { folder: cur, prefix: m[1], folderName: cur.name };
		}
		cur = cur.parent;
	}
	return null;
}

function existingZeroIds(folder: TFolder, prefix: string): Set<string> {
	const out = new Set<string>();
	const head = `${prefix}.`;
	for (const child of folder.children) {
		if (!child.name.startsWith(head)) continue;
		const d0 = child.name.charCodeAt(head.length);
		const d1 = child.name.charCodeAt(head.length + 1);
		if (!isAsciiDigit(d0) || !isAsciiDigit(d1)) continue;
		const after = child.name.charAt(head.length + 2);
		if (after !== "" && after !== " " && after !== "." && after !== "+") continue;
		out.add(child.name.slice(head.length, head.length + 2));
	}
	return out;
}

function isAsciiDigit(code: number): boolean {
	return code >= 48 && code <= 57;
}

// ── Picker modals ────────────────────────────────────────────────

interface ZeroChoice {
	zero: ZeroSpec;
	exists: boolean;
}

class ZeroPickerModal extends SuggestModal<ZeroChoice> {
	constructor(
		app: App,
		private choices: ZeroChoice[],
		private onChoice: (z: ZeroChoice) => void
	) {
		super(app);
		this.setPlaceholder("Pick a standard zero...");
	}

	getSuggestions(query: string): ZeroChoice[] {
		const q = query.toLowerCase().trim();
		if (!q) return this.choices;
		return this.choices.filter(
			(c) => c.zero.id.includes(q) || c.zero.name.toLowerCase().includes(q)
		);
	}

	renderSuggestion(item: ZeroChoice, el: HTMLElement): void {
		const row = el.createDiv({ cls: "jd-zero-row" });
		row.createSpan({ text: item.zero.id, cls: "jd-zero-id" });
		row.createSpan({ text: " " });
		row.createSpan({ text: item.zero.name, cls: "jd-zero-name" });
		if (item.exists) {
			row.createSpan({ text: " (exists)", cls: "jd-zero-exists" });
		}
	}

	onChooseSuggestion(item: ZeroChoice): void {
		this.onChoice(item);
	}
}

class StemPickerModal extends SuggestModal<string> {
	constructor(app: App, private codes: string[], private onChoice: (code: string) => void) {
		super(app);
		this.setPlaceholder("Pick a stem code...");
	}

	getSuggestions(query: string): string[] {
		const q = query.toUpperCase().trim();
		if (!q) return this.codes;
		return this.codes.filter((c) => c.includes(q));
	}

	renderSuggestion(item: string, el: HTMLElement): void {
		el.setText(`+${item}`);
	}

	onChooseSuggestion(item: string): void {
		this.onChoice(item);
	}
}

// ── Commands ─────────────────────────────────────────────────────

export async function newStandardZeroFromTemplate(
	app: App,
	file: TFile,
	settings: JDSettings
): Promise<void> {
	const cat = findCategoryFolder(file);
	if (!cat) {
		new Notice("No JD category folder found from active file");
		return;
	}

	const templates = await listTemplates(app, settings.templatesFolder);
	const existing = existingZeroIds(cat.folder, cat.prefix);
	const suffix = suffixFor(cat.prefix);
	const zeros = standardZeros(cat.prefix, suffix);
	const choices: ZeroChoice[] = zeros.map((zero) => ({
		zero,
		exists: existing.has(zero.id),
	}));

	new ZeroPickerModal(app, choices, async (choice) => {
		if (choice.exists) {
			new Notice(`${cat.prefix}.${choice.zero.id} already exists`);
			return;
		}
		const template = findZeroTemplate(templates, choice.zero.id);
		if (!template) {
			new Notice(`No template for slot ${choice.zero.id} in ${settings.templatesFolder}`);
			return;
		}
		const ctx = buildContext({
			prefix: cat.prefix,
			id: choice.zero.id,
			folder: { path: cat.folder.path, name: cat.folderName },
			zero: choice.zero,
		});
		const destPath = destPathForZero({ path: cat.folder.path }, cat.prefix, choice.zero);
		try {
			const { file: created } = await createFromTemplate(app, template, ctx, destPath);
			await app.workspace.getLeaf().openFile(created);
			new Notice(`Created ${choice.zero.name}`);
		} catch (e) {
			new Notice(`Failed: ${(e as Error).message}`);
		}
	}).open();
}

export async function newGenericIdFromTemplate(
	app: App,
	file: TFile,
	settings: JDSettings
): Promise<void> {
	const cat = findCategoryFolder(file);
	if (!cat) {
		new Notice("No JD category folder found from active file");
		return;
	}

	const idRaw = await inputPrompt(app, `New ID in ${cat.folderName}`, "ID number (e.g. 10)");
	if (!idRaw) return;
	const id = idRaw.trim().padStart(2, "0");
	if (!/^\d{2}$/.test(id)) {
		new Notice("ID must be two digits");
		return;
	}

	const title = await inputPrompt(app, "Title for the new ID", "e.g. Config files");
	if (!title || !title.trim()) return;

	const templates = await listTemplates(app, settings.templatesFolder);
	const template = findGenericTemplate(templates);
	if (!template) {
		new Notice(`No generic ID template in ${settings.templatesFolder}`);
		return;
	}

	const ctx = buildContext({
		prefix: cat.prefix,
		id,
		folder: { path: cat.folder.path, name: cat.folderName },
		customTitle: title.trim(),
	});
	const destPath = destPathForGenericId({ path: cat.folder.path }, cat.prefix, id, title.trim());
	try {
		const { file: created } = await createFromTemplate(app, template, ctx, destPath);
		await app.workspace.getLeaf().openFile(created);
		new Notice(`Created ${id} ${title.trim()}`);
	} catch (e) {
		new Notice(`Failed: ${(e as Error).message}`);
	}
}

export async function newStemFromTemplate(
	app: App,
	file: TFile,
	settings: JDSettings
): Promise<void> {
	const cat = findCategoryFolder(file);
	if (!cat) {
		new Notice("No JD category folder found from active file");
		return;
	}

	const templates = await listTemplates(app, settings.templatesFolder);
	const codes = listStemCodes(templates);
	if (codes.length === 0) {
		new Notice(`No stem templates in ${settings.templatesFolder}`);
		return;
	}

	new StemPickerModal(app, codes, async (code) => {
		const name = await inputPrompt(
			app,
			`New +${code} stem`,
			"Stem name (e.g. 'Session directives')"
		);
		if (!name || !name.trim()) return;

		const template = findStemTemplate(templates, code);
		if (!template) {
			new Notice(`No template for stem code ${code}`);
			return;
		}

		const ctx = buildContext({
			prefix: cat.prefix,
			id: `+${code}`,
			folder: { path: cat.folder.path, name: cat.folderName },
			customTitle: name.trim(),
		});
		const destPath = destPathForStem({ path: cat.folder.path }, cat.prefix, code, name.trim());
		try {
			const { file: created } = await createFromTemplate(app, template, ctx, destPath);
			await app.workspace.getLeaf().openFile(created);
			new Notice(`Created +${code} ${name.trim()}`);
		} catch (e) {
			new Notice(`Failed: ${(e as Error).message}`);
		}
	}).open();
}
