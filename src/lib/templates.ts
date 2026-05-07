/**
 * Template-driven note creation. Reads templates from a configurable folder,
 * substitutes placeholders, creates the new note at the right JD location.
 *
 * Supported placeholder dialects (both treated identically):
 *   {{var}}        Templater / Core Templates style (preferred)
 *   %var%          Legacy QuickAdd-ish style
 *
 * Plus formatted dates / times via moment.js tokens:
 *   {{date:YYYY-MM-DD}}
 *   {{time:HH:mm}}
 *
 * Templates are classified by their `jd-id` frontmatter field:
 *   "{{category}}.NN"        → standard zero, slot NN
 *   "XX.00+CODE"             → stem template, code CODE
 *   "{{category}}.{{id}}"    → generic ID template
 */

import { type App, TFile, TFolder, moment } from "obsidian";
import type { Moment } from "moment";
import type { ZeroSpec } from "./standard-zeros";

// ── Scope ────────────────────────────────────────────────────────

/**
 * Scope phrase for a category prefix:
 *   "00"             → "the system"
 *   "x0"  (x > 0)    → "area x0-x9"
 *   "xy"  (y > 0)    → "category xy"
 */
export function scopeFor(prefix: string): string {
	if (prefix === "00") return "the system";
	if (/^[1-9]0$/.test(prefix)) {
		const head = prefix[0];
		return `area ${head}0-${head}9`;
	}
	return `category ${prefix}`;
}

// ── Placeholder context ──────────────────────────────────────────

export interface PlaceholderContext {
	category: string;
	prefix: string;
	id: string;
	fullId: string;
	scope: string;
	folder: string;
	folderName: string;
	title: string;
	tag: string;
	date: string;
	time: string;
	now: string;
}

export interface BuildContextOpts {
	prefix: string;
	id: string;
	folder: { path: string; name: string };
	zero?: ZeroSpec;
	customTitle?: string;
	customTag?: string;
	now?: Moment;
}

export function buildContext(opts: BuildContextOpts): PlaceholderContext {
	const now = opts.now ?? moment();
	const isStem = opts.id.startsWith("+");
	const fullId = isStem ? `${opts.prefix}.00${opts.id}` : `${opts.prefix}.${opts.id}`;
	return {
		category: opts.prefix,
		prefix: opts.prefix,
		id: opts.id,
		fullId,
		scope: scopeFor(opts.prefix),
		folder: opts.folder.path,
		folderName: opts.folder.name,
		title: opts.customTitle ?? opts.zero?.name ?? "",
		tag: opts.customTag ?? opts.zero?.tag ?? "",
		date: now.format("YYYY-MM-DD"),
		time: now.format("HH:mm"),
		now: now.format("YYYY-MM-DDTHH:mm"),
	};
}

// ── Substitution ─────────────────────────────────────────────────

function valueFor(ctx: PlaceholderContext, key: string): string | null {
	switch (key) {
		case "category": return ctx.category;
		case "prefix": return ctx.prefix;
		case "id": return ctx.id;
		case "full-id":
		case "fullId": return ctx.fullId;
		case "scope": return ctx.scope;
		case "folder": return ctx.folder;
		case "folder-name":
		case "folderName": return ctx.folderName;
		case "title": return ctx.title;
		case "tag": return ctx.tag;
		case "date": return ctx.date;
		case "time": return ctx.time;
		case "now": return ctx.now;
		default: return null;
	}
}

// Static patterns — no dynamic RegExp construction.
const PLACEHOLDER_BRACE = /\{\{([a-zA-Z][a-zA-Z-]*)\}\}/g;
const PLACEHOLDER_PERCENT = /%([a-zA-Z][a-zA-Z-]*)%/g;
const FORMAT_DATE_BRACE = /\{\{(date|time):([^}]+)\}\}/g;
const FORMAT_DATE_PERCENT = /%(date|time):([^%]+)%/g;

/**
 * Substitute placeholders in template content. Both {{var}} and %var% are
 * accepted. Formatted dates use {{date:FORMAT}} (FORMAT is a moment.js token
 * string, e.g. "YYYY-MM-DD"). Unknown placeholders are left as-is.
 */
export function substitute(content: string, ctx: PlaceholderContext): string {
	let out = content;

	// Formatted date/time first so {{date:FORMAT}} doesn't match the plain {{date}} rule.
	out = out.replace(FORMAT_DATE_BRACE, (_m, _kind, fmt) => moment().format(fmt));
	out = out.replace(FORMAT_DATE_PERCENT, (_m, _kind, fmt) => moment().format(fmt));

	out = out.replace(PLACEHOLDER_BRACE, (m, key) => {
		const v = valueFor(ctx, key);
		return v === null ? m : v;
	});
	out = out.replace(PLACEHOLDER_PERCENT, (m, key) => {
		const v = valueFor(ctx, key);
		return v === null ? m : v;
	});

	return out;
}

// ── Template discovery ───────────────────────────────────────────

export type TemplateRole =
	| { type: "zero"; zeroId: string }
	| { type: "stem"; stemCode: string }
	| { type: "generic" };

export interface TemplateMatch {
	file: TFile;
	role: TemplateRole;
}

const ZERO_ID_RE = /^\{\{category\}\}\.(\d{2})$/;
const STEM_ID_RE = /^XX\.00\+([A-Z]+)$/;
const GENERIC_ID_RE = /^\{\{category\}\}\.\{\{id\}\}$/;

function parseJdId(content: string): string | null {
	const m = content.match(/^jd-id:\s*"?([^"\n]+?)"?\s*$/m);
	return m ? m[1].trim() : null;
}

function classify(jdId: string | null): TemplateRole | null {
	if (!jdId) return null;
	const zero = jdId.match(ZERO_ID_RE);
	if (zero) return { type: "zero", zeroId: zero[1] };
	const stem = jdId.match(STEM_ID_RE);
	if (stem) return { type: "stem", stemCode: stem[1] };
	if (GENERIC_ID_RE.test(jdId)) return { type: "generic" };
	return null;
}

export async function listTemplates(app: App, folderPath: string): Promise<TemplateMatch[]> {
	const folder = app.vault.getAbstractFileByPath(folderPath);
	if (!(folder instanceof TFolder)) return [];

	const out: TemplateMatch[] = [];
	for (const child of folder.children) {
		if (!(child instanceof TFile) || child.extension !== "md") continue;
		const content = await app.vault.cachedRead(child);
		const role = classify(parseJdId(content));
		if (role) out.push({ file: child, role });
	}
	return out;
}

export function findZeroTemplate(templates: TemplateMatch[], zeroId: string): TemplateMatch | null {
	return templates.find((t) => t.role.type === "zero" && t.role.zeroId === zeroId) ?? null;
}

export function findStemTemplate(templates: TemplateMatch[], stemCode: string): TemplateMatch | null {
	return templates.find((t) => t.role.type === "stem" && t.role.stemCode === stemCode) ?? null;
}

export function findGenericTemplate(templates: TemplateMatch[]): TemplateMatch | null {
	return templates.find((t) => t.role.type === "generic") ?? null;
}

export function listStemCodes(templates: TemplateMatch[]): string[] {
	return templates
		.filter((t): t is TemplateMatch & { role: { type: "stem"; stemCode: string } } => t.role.type === "stem")
		.map((t) => t.role.stemCode)
		.sort();
}

// ── Creation ─────────────────────────────────────────────────────

export interface CreationResult {
	file: TFile;
	destPath: string;
}

export async function createFromTemplate(
	app: App,
	template: TemplateMatch,
	ctx: PlaceholderContext,
	destPath: string
): Promise<CreationResult> {
	const content = await app.vault.cachedRead(template.file);
	const substituted = substitute(content, ctx);

	const parentPath = destPath.substring(0, destPath.lastIndexOf("/"));
	if (parentPath) {
		const parent = app.vault.getAbstractFileByPath(parentPath);
		if (!parent) {
			await app.vault.createFolder(parentPath);
		} else if (!(parent instanceof TFolder)) {
			throw new Error(`Path exists but is not a folder: ${parentPath}`);
		}
	}

	if (app.vault.getAbstractFileByPath(destPath)) {
		throw new Error(`File already exists: ${destPath}`);
	}

	const file = await app.vault.create(destPath, substituted);
	return { file, destPath };
}

// ── Destination paths ────────────────────────────────────────────

export function destPathForZero(
	folder: { path: string },
	prefix: string,
	zero: ZeroSpec
): string {
	const basename = `${prefix}.${zero.id} ${zero.name}`;
	return zero.hasDir ? `${folder.path}/${basename}/${basename}.md` : `${folder.path}/${basename}.md`;
}

export function destPathForStem(
	folder: { path: string },
	prefix: string,
	code: string,
	name: string
): string {
	return `${folder.path}/${prefix}.00+${code} ${name}.md`;
}

export function destPathForGenericId(
	folder: { path: string },
	prefix: string,
	id: string,
	title: string
): string {
	return `${folder.path}/${prefix}.${id} ${title}.md`;
}
