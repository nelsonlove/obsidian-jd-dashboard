/**
 * Johnny Decimal Dashboard — Obsidian plugin entry point.
 *
 * Provides live JD system awareness: inbox dashboard, drift detection,
 * quick ID navigation. Reads the same jd-index.yaml and jd.yaml that
 * jd-cli uses, with no runtime dependency on the Python tool.
 */

import { Notice, Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import { type JDSettings, DEFAULT_SETTINGS, JDSettingsTab } from "./settings";
import { InboxDashboardView, VIEW_TYPE_INBOX } from "./views/inbox-dashboard";
import { DriftPanelView, VIEW_TYPE_DRIFT } from "./views/drift-panel";
import { GoToIdModal } from "./commands/go-to-id";
import { generateDriftReport } from "./commands/drift-report";
import { generateAuditReport } from "./commands/audit-report";
import { migrateReadmeFiles } from "./commands/migrate-readme";
import { renderCategoryJdex } from "./commands/render-jdex";
import { promoteToFolder } from "./commands/promote-to-folder";
import { renderFiles } from "./commands/render-files";
import { renumberCommand } from "./commands/renumber";
import { indexFolderNote } from "./commands/index-folder-note";
import { standardZerosCommand } from "./commands/standard-zeros";
import { newCategoryCommand } from "./commands/new-category";
import { indexVault, indexCategory } from "./commands/index-vault";
import { scanDrift } from "./scanner";
import { parseJDex, parseJDConfig, type JDex, type JDConfig } from "./jdex";
import { FrontmatterNormalizer } from "./normalizer";
import { getKeys } from "./keys";
import { readFileSync, watchFile, unwatchFile } from "fs";

export default class JDDashboardPlugin extends Plugin {
	settings: JDSettings = DEFAULT_SETTINGS;
	jdex: JDex | null = null;
	jdConfig: JDConfig | null = null;
	private normalizer!: FrontmatterNormalizer;
	private watchedJdexPath: string | null = null;
	private watchedConfigPath: string | null = null;
	private reloadDebouncer: ReturnType<typeof setTimeout> | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.loadJDex();
		this.loadJDConfig();
		this.normalizer = new FrontmatterNormalizer(this.app, this.settings);

		// Register views
		this.registerView(
			VIEW_TYPE_INBOX,
			(leaf) => new InboxDashboardView(leaf, this)
		);
		this.registerView(
			VIEW_TYPE_DRIFT,
			(leaf) => new DriftPanelView(leaf, this)
		);

		// Ribbon icons
		this.addRibbonIcon("inbox", "JD Inboxes", () => {
			this.activateInboxView();
		});
		this.addRibbonIcon("alert-triangle", "JD Drift", () => {
			this.activateDriftView();
		});

		// Commands
		this.addCommand({
			id: "open-inbox-dashboard",
			name: "Open inbox dashboard",
			callback: () => this.activateInboxView(),
		});

		this.addCommand({
			id: "go-to-id",
			name: "Go to ID",
			callback: () => new GoToIdModal(this.app).open(),
		});

		this.addCommand({
			id: "open-drift-panel",
			name: "Open drift panel",
			callback: () => this.activateDriftView(),
		});

		this.addCommand({
			id: "check-drift",
			name: "Check for drift",
			callback: () => this.checkDrift(),
		});

		this.addCommand({
			id: "drift-report",
			name: "Generate drift report",
			callback: () => generateDriftReport(this.app, this.jdex, this.settings),
		});

		this.addCommand({
			id: "vault-audit",
			name: "Run vault audit",
			callback: () =>
				generateAuditReport(this.app, this.jdex, this.settings, {
					staleDays: this.settings.staleDays,
					jdConfig: this.jdConfig,
				}),
		});

		this.addCommand({
			id: "migrate-readme",
			name: "Migrate +README files to folder-named cover notes",
			callback: () => migrateReadmeFiles(this.app, getKeys(this.settings)),
		});

		this.addCommand({
			id: "render-category-jdex",
			name: "Render category JDex contents",
			callback: () => {
				if (!this.jdex) {
					new Notice("JDex not loaded — check JDex path setting.");
					return;
				}
				renderCategoryJdex(this.app, this.jdex, this.settings);
			},
		});

		this.addCommand({
			id: "reload-jdex",
			name: "Reload JDex and config from disk",
			callback: () => this.reloadJDexAndConfig("manual"),
		});

		this.addCommand({
			id: "promote-to-folder",
			name: "Promote note to folder",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!file.path.endsWith(".md")) return false;
				if (checking) return true;
				promoteToFolder(this.app, file);
				return true;
			},
		});

		this.addCommand({
			id: "render-files",
			name: "Render filesystem contents",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!file.path.endsWith(".md")) return false;
				if (checking) return true;
				renderFiles(this.app, this.settings, file);
				return true;
			},
		});

		this.addCommand({
			id: "renumber",
			name: "Renumber active note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!file.path.endsWith(".md")) return false;
				if (checking) return true;
				renumberCommand(this.app, file);
				return true;
			},
		});

		this.addCommand({
			id: "index-folder-note",
			name: "Index folder note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!file.path.endsWith(".md")) return false;
				if (checking) return true;
				indexFolderNote(this.app, file);
				return true;
			},
		});

		this.addCommand({
			id: "index-category",
			name: "Index category (active .00 note)",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!/^\d{2}\.00\b/.test(file.basename)) return false;
				if (checking) return true;
				indexCategory(this.app, file);
				return true;
			},
		});

		this.addCommand({
			id: "index-vault",
			name: "Index entire vault",
			callback: () => indexVault(this.app),
		});

		this.addCommand({
			id: "standard-zeros",
			name: "Create standard zeros in current category",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (checking) return true;
				standardZerosCommand(this.app, file);
				return true;
			},
		});

		this.addCommand({
			id: "new-category",
			name: "New category in current area",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (checking) return true;
				newCategoryCommand(this.app, file);
				return true;
			},
		});

		// Settings tab
		this.addSettingTab(new JDSettingsTab(this.app, this));

		// Status bar — drift count (clickable)
		const statusEl = this.addStatusBarItem();
		statusEl.addClass("jd-status-drift");
		statusEl.addEventListener("click", () => this.activateDriftView());
		this.registerEvent(
			this.app.metadataCache.on("resolved", () => {
				this.updateStatusBar(statusEl);
			})
		);
		// Initial update after a short delay to let metadata cache populate
		this.app.workspace.onLayoutReady(() => {
			setTimeout(() => this.updateStatusBar(statusEl), 2000);
		});

		// Optional audit on startup
		if (this.settings.auditOnStartup) {
			this.app.workspace.onLayoutReady(() => {
				setTimeout(() => {
					generateAuditReport(this.app, this.jdex, this.settings, {
						staleDays: this.settings.staleDays,
						jdConfig: this.jdConfig,
					});
				}, 5000); // wait for metadata cache to settle
			});
		}

		// Frontmatter normalizer — auto-fix on save
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (!(file instanceof TFile)) return;
				if (!file.path.endsWith(".md")) return;
				if (this.normalizer.isGuarded(file.path)) return;
				this.normalizer.normalize(file);
			})
		);
	}

	async onunload(): Promise<void> {
		// Views are automatically deregistered
		if (this.watchedJdexPath) {
			unwatchFile(this.watchedJdexPath);
			this.watchedJdexPath = null;
		}
		if (this.watchedConfigPath) {
			unwatchFile(this.watchedConfigPath);
			this.watchedConfigPath = null;
		}
		if (this.reloadDebouncer) {
			clearTimeout(this.reloadDebouncer);
			this.reloadDebouncer = null;
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.normalizer?.updateSettings(this.settings);
	}

	private resolvePath(p: string): string {
		return p.replace("~", process.env.HOME ?? "");
	}

	private loadJDex(): void {
		try {
			const jdexPath = this.resolvePath(this.settings.jdexPath);
			const raw = readFileSync(jdexPath, "utf-8");
			this.jdex = parseJDex(raw);
			this.watchPath("jdex", jdexPath);
		} catch {
			this.jdex = null;
		}
	}

	private loadJDConfig(): void {
		try {
			const path = this.resolvePath(this.settings.jdConfigPath);
			const raw = readFileSync(path, "utf-8");
			this.jdConfig = parseJDConfig(raw);
			this.watchPath("config", path);
		} catch {
			this.jdConfig = null;
		}
	}

	/**
	 * Watch jdex/config file for external changes (jd-cli writes, manual edits)
	 * and trigger a debounced reload. The vault event system doesn't see files
	 * outside the vault, so we use Node's fs.watchFile directly.
	 */
	private watchPath(kind: "jdex" | "config", path: string): void {
		const current = kind === "jdex" ? this.watchedJdexPath : this.watchedConfigPath;
		if (current === path) return;
		if (current) unwatchFile(current);
		watchFile(path, { interval: 1000 }, (curr, prev) => {
			if (curr.mtimeMs !== prev.mtimeMs) this.scheduleReload();
		});
		if (kind === "jdex") this.watchedJdexPath = path;
		else this.watchedConfigPath = path;
	}

	private scheduleReload(): void {
		if (this.reloadDebouncer) clearTimeout(this.reloadDebouncer);
		this.reloadDebouncer = setTimeout(() => {
			this.reloadDebouncer = null;
			this.reloadJDexAndConfig("file changed");
		}, 250);
	}

	reloadJDexAndConfig(reason: string): void {
		this.loadJDex();
		this.loadJDConfig();
		new Notice(`JD: reloaded (${reason})`);
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DRIFT)) {
			const view = leaf.view as DriftPanelView;
			if (typeof view.render === "function") view.render();
		}
	}

	async activateInboxView(): Promise<void> {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_INBOX)[0];

		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (!rightLeaf) return;
			leaf = rightLeaf;
			await leaf.setViewState({ type: VIEW_TYPE_INBOX, active: true });
		}

		workspace.revealLeaf(leaf);
	}

	async activateDriftView(): Promise<void> {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_DRIFT)[0];

		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (!rightLeaf) return;
			leaf = rightLeaf;
			await leaf.setViewState({ type: VIEW_TYPE_DRIFT, active: true });
		}

		workspace.revealLeaf(leaf);
	}

	private updateStatusBar(el: HTMLElement): void {
		const drift = scanDrift(this.app, getKeys(this.settings));
		if (drift.length > 0) {
			el.setText(`JD: ${drift.length} drifted`);
			el.title = drift.map((d) => d.detail).join("\n");
		} else {
			el.setText("");
			el.title = "";
		}
	}

	private checkDrift(): void {
		const drift = scanDrift(this.app, getKeys(this.settings));
		if (drift.length === 0) {
			new Notice("No drift detected — all JD notes are consistent.");
			return;
		}
		new Notice(`Found ${drift.length} drifted notes. Check the console for details.`);
		console.group("JD Drift Report");
		for (const item of drift) {
			console.log(`[${item.issue}] ${item.path}: ${item.detail}`);
		}
		console.groupEnd();
	}
}
