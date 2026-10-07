import { GEAR_TYPES, isChest } from "./data.js";
import { addDocumentToChest } from "./loot.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * @returns {{ id: string, label: string }[]}
 */
export function listItemSources() {
  const sources = [{ id: "world", label: game.i18n.localize("TREASURE_CHEST.Browser.World") }];
  const packs = [];
  for (const pack of game.packs) {
    if (pack.documentName !== "Item") continue;
    packs.push({
      id: pack.collection,
      label: pack.metadata?.label || pack.title || pack.collection
    });
  }
  packs.sort((a, b) => a.label.localeCompare(b.label));
  return sources.concat(packs);
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
    const sources = listItemSources().map((source) => ({
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
