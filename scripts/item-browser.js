import { GEAR_TYPES, isChest } from "./data.js";
import { addDocumentToChest } from "./loot.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const SLOW_LOAD_MS = 3000;

/** @type {Map<string, boolean>} */
const gearPackCache = new Map();

/** @type {{ id: string, label: string }[]|null} */
let sourcesCache = null;

let noticeGeneration = 0;
let slowTimer = 0;
/** @type {Application|null} */
let slowDialog = null;

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[character]));
}

/**
 * @param {string} message
 * @returns {() => void}
 */
function beginSlowNotice(message) {
  const generation = ++noticeGeneration;
  window.clearTimeout(slowTimer);
  slowTimer = 0;
  closeSlowNotice();
  slowTimer = window.setTimeout(() => {
    if (generation !== noticeGeneration) return;
    const DialogV2 = foundry.applications.api.DialogV2;
    slowDialog = new DialogV2({
      window: { title: game.i18n.localize("TREASURE_CHEST.Browser.LoadingTitle") },
      position: { width: 440 },
      modal: true,
      content: `<p class="treasure-chest-loading">${escapeHtml(message)}</p>`,
      buttons: [{
        action: "ok",
        label: game.i18n.localize("TREASURE_CHEST.Browser.LoadingDismiss"),
        default: true
      }]
    });
    void slowDialog.render({ force: true });
  }, SLOW_LOAD_MS);
  return () => {
    if (generation !== noticeGeneration) return;
    window.clearTimeout(slowTimer);
    slowTimer = 0;
    closeSlowNotice();
  };
}

function closeSlowNotice() {
  const dialog = slowDialog;
  slowDialog = null;
  if (dialog?.rendered) void dialog.close();
}

/**
 * @param {CompendiumCollection} pack
 * @returns {Promise<boolean>}
 */
async function packContainsGear(pack) {
  if (gearPackCache.has(pack.collection)) return gearPackCache.get(pack.collection);
  let hasGear = false;
  try {
    const index = await pack.getIndex({ fields: ["type"] });
    const rows = index.contents ?? [...index];
    let sawType = false;
    for (const entry of rows) {
      if (!entry.type) continue;
      sawType = true;
      if (GEAR_TYPES.has(entry.type)) {
        hasGear = true;
        break;
      }
    }
    if (!hasGear && rows.length && !sawType) hasGear = true;
  } catch (error) {
    console.error("Treasure Chest | Could not index compendium", pack.collection, error);
    hasGear = false;
  }
  gearPackCache.set(pack.collection, hasGear);
  return hasGear;
}

/**
 * World items, plus item compendiums that actually contain gear.
 * @returns {Promise<{ id: string, label: string }[]>}
 */
export async function listItemSources() {
  if (sourcesCache) return sourcesCache;
  const sources = [{ id: "world", label: game.i18n.localize("TREASURE_CHEST.Browser.World") }];
  const packs = [];
  for (const pack of game.packs) {
    if (pack.documentName !== "Item") continue;
    if (!(await packContainsGear(pack))) continue;
    packs.push({
      id: pack.collection,
      label: pack.metadata?.label || pack.title || pack.collection
    });
  }
  packs.sort((a, b) => a.label.localeCompare(b.label));
  sourcesCache = sources.concat(packs);
  return sourcesCache;
}

/**
 * @param {string} sourceId
 * @returns {Promise<{ id: string, name: string, nameLower: string, img: string }[]>}
 */
export async function loadBrowserEntries(sourceId) {
  if (sourceId === "world") {
    return game.items
      .filter((item) => GEAR_TYPES.has(item.type) && !isChest(item))
      .map((item) => ({
        id: item.id,
        name: item.name,
        nameLower: item.name.toLowerCase(),
        img: item.img
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const pack = game.packs.get(sourceId);
  if (!pack) return [];
  const index = await pack.getIndex();
  const rows = index.contents ?? [...index];
  return rows
    .filter((entry) => GEAR_TYPES.has(entry.type))
    .map((entry) => ({
      id: entry._id,
      name: entry.name,
      nameLower: String(entry.name ?? "").toLowerCase(),
      img: entry.img
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export class ItemBrowserDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @param {{ chest: Item }} options */
  constructor(options) {
    super({ id: `treasure-chest-browser-${options.chest.id}` });
    this.chest = options.chest;
    this.sourceId = "world";
    this.query = "";
    this.loadError = false;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["treasure-chest", "treasure-chest-browser-app"],
    position: { width: 480, height: 560 },
    window: { resizable: true },
    actions: {
      addSelected: ItemBrowserDialog.#onAddSelected
    }
  };

  /** @override */
  static PARTS = {
    body: {
      template: "modules/treasure-chest/templates/item-browser.hbs",
      scrollable: [".browser-results"]
    }
  };

  /** @override */
  get title() {
    return game.i18n.format("TREASURE_CHEST.Browser.Title", { name: this.chest.name });
  }

  /** @override */
  async _prepareContext() {
    const pack = this.sourceId === "world" ? null : game.packs.get(this.sourceId);
    const message = sourcesCache
      ? game.i18n.format("TREASURE_CHEST.Browser.LoadingPack", {
        name: pack?.metadata?.label || pack?.title || this.sourceId
      })
      : game.i18n.localize("TREASURE_CHEST.Browser.LoadingScan");
    const endNotice = beginSlowNotice(message);
    try {
      let sources = await listItemSources();
      if (!sources.some((source) => source.id === this.sourceId)) this.sourceId = "world";
      sources = sources.map((source) => ({
        ...source,
        selected: source.id === this.sourceId
      }));
      let entries = [];
      this.loadError = false;
      try {
        entries = await loadBrowserEntries(this.sourceId);
      } catch (error) {
        console.error("Treasure Chest | Item browser failed", error);
        this.loadError = true;
      }
      return {
        sources,
        entries,
        query: this.query,
        loadError: this.loadError
      };
    } finally {
      endNotice();
    }
  }

  /** @override */
  _onRender() {
    const source = this.element.querySelector("[data-role='source']");
    if (source && source.dataset.bound !== "1") {
      source.dataset.bound = "1";
      source.addEventListener("change", () => {
        this.sourceId = source.value;
        this.query = "";
        this.render(false);
      });
    }

    const search = this.element.querySelector("[data-role='search']");
    if (search && search.dataset.bound !== "1") {
      search.dataset.bound = "1";
      search.addEventListener("input", () => {
        this.query = search.value;
        applyBrowserFilter(this.element, this.query);
      });
    }
    applyBrowserFilter(this.element, this.query);
  }

  static async #onAddSelected() {
    const dialog = /** @type {ItemBrowserDialog} */ (this);
    const selected = [...dialog.element.querySelectorAll("input[data-role='pick']:checked")].map((input) => input.value);
    if (!selected.length) return;

    const pack = dialog.sourceId === "world" ? null : game.packs.get(dialog.sourceId);
    let added = 0;
    let lastName = "";
    for (const id of selected) {
      let doc = null;
      if (!pack) doc = game.items.get(id);
      else doc = await pack.getDocument(id);
      if (!doc) {
        ui.notifications.warn(game.i18n.format("TREASURE_CHEST.Notifications.Unresolved", { name: id }));
        continue;
      }
      const ok = await addDocumentToChest(dialog.chest, doc, { quiet: true });
      if (ok) {
        added += 1;
        lastName = doc.name;
      }
    }

    if (added === 1) {
      ui.notifications.info(game.i18n.format("TREASURE_CHEST.Notifications.Added", { name: lastName }));
    } else if (added > 1) {
      ui.notifications.info(game.i18n.format("TREASURE_CHEST.Notifications.AddedMany", { count: added }));
    }
    dialog.render(false);
  }
}

/**
 * @param {HTMLElement} root
 * @param {string} query
 */
function applyBrowserFilter(root, query) {
  const needle = query.trim().toLowerCase();
  const rows = [...root.querySelectorAll("[data-item-id]")];
  let matched = 0;
  let shown = 0;
  for (const row of rows) {
    const match = !needle || (row.dataset.name ?? "").includes(needle);
    if (!match) {
      row.hidden = true;
      continue;
    }
    matched += 1;
    if (shown >= 100) {
      row.hidden = true;
      continue;
    }
    row.hidden = false;
    shown += 1;
  }

  const count = root.querySelector("[data-role='count']");
  if (!count) return;
  count.textContent = rows.length
    ? game.i18n.format("TREASURE_CHEST.Browser.Count", { shown, matched })
    : game.i18n.localize("TREASURE_CHEST.Browser.Empty");
}
