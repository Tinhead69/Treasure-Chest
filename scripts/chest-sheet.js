import {
  DENOMINATIONS,
  MODULE_ID,
  SECTION_ORDER,
  chestPortrait,
  getContents,
  getCurrency,
  getSecurity,
  groupContents,
  isChest,
  isChestHidden,
  needsDefaultPortrait,
  sealReason,
  setContents
} from "./data.js";
import {
  addDocumentToChest,
  chooseLootPlace,
  isLootBlocked,
  lootRecipient,
  takeAll,
  takeCurrency,
  takeItem
} from "./loot.js";
import { openChestGate, shouldGate } from "./chest-gate.js";
import { requestCheck, securityFormOptions, securityFromForm } from "./security.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

// [dnd5e translation key, English fallback]. Borrowing dnd5e's own words means
// the headings follow the player's language without extra lang entries.
const SECTION_LABELS = {
  weapon: ["DND5E.ItemTypeWeaponPl", "Weapons"],
  equipment: ["DND5E.ItemTypeEquipmentPl", "Equipment"],
  consumable: ["DND5E.ItemTypeConsumablePl", "Consumables"],
  tool: ["DND5E.ItemTypeToolPl", "Tools"],
  container: ["DND5E.ItemTypeContainerPl", "Containers"],
  loot: ["DND5E.ItemTypeLootPl", "Loot"]
};

export class ChestSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["treasure-chest", "sheet", "item"],
    position: { width: 580, height: 700 },
    window: { resizable: true },
    tag: "form",
    form: {
      submitOnChange: true,
      closeOnSubmit: false,
      handler: ChestSheet.#onSubmit
    },
    actions: {
      editImage: ChestSheet.#onEditImage,
      browse: ChestSheet.#onBrowse,
      takeItem: ChestSheet.#onTakeItem,
      takeDenom: ChestSheet.#onTakeDenom,
      takeCoins: ChestSheet.#onTakeCoins,
      takeAll: ChestSheet.#onTakeAll,
      removeItem: ChestSheet.#onRemoveItem,
      showItem: ChestSheet.#onShowItem,
      examine: ChestSheet.#onExamine,
      understand: ChestSheet.#onUnderstand,
      disarm: ChestSheet.#onDisarm,
      unlock: ChestSheet.#onUnlock,
      force: ChestSheet.#onForce
    }
  };

  /** @override */
  static PARTS = {
    body: {
      template: "modules/treasure-chest/templates/chest-sheet.hbs",
      scrollable: [""]
    }
  };

  constructor(options = {}) {
    super(options);
  }

  /** @override */
  static _canRenderDocument(document) {
    return isChest(document);
  }

  /**
   * Players cannot open a sealed chest, whichever way they try (double-click,
   * the Items sidebar, a link). They get the pop-up instead. A sheet that is
   * already open is left alone.
   * @override
   */
  _canRender(options) {
    const result = super._canRender?.(options);
    if (result === false) return false;
    if (!this.rendered && shouldGate(this.document)) {
      void openChestGate(this.document);
      return false;
    }
  }

  /** @override */
  get title() {
    return this.document.name;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const contents = getContents(this.document);
    const grouped = groupContents(contents);
    const currency = getCurrency(this.document);
    const security = getSecurity(this.document);
    const sealed = sealReason(this.document);
    const lockedShut = security.locked && !security.unlocked;
    const armed = security.trapped && !security.disarmed && !security.triggered;
    const lootingBlocked = isLootBlocked(this.document);
    const canTake = !lootingBlocked && !sealed;
    const showExamine = security.trapped && !security.detected;
    const sealedText = lockedShut && armed
      ? game.i18n.localize("TREASURE_CHEST.Sheet.Sealed")
      : lockedShut
        ? game.i18n.localize("TREASURE_CHEST.Sheet.SealedLocked")
        : armed
          ? game.i18n.localize("TREASURE_CHEST.Sheet.SealedArmed")
          : "";
    const showUnderstand = armed && security.detected && !security.understood;
    const showDisarm = armed && security.understood;
    const showUnlock = security.locked && !security.unlocked;

    return {
      ...context,
      editable: this.isEditable,
      isGm: game.user.isGM,
      hiddenFromPlayers: isChestHidden(this.document),
      item: this.document,
      chestName: this.document.name ?? "",
      portrait: chestPortrait(this.document),
      totals: {
        count: contents.length,
        quantity: contents.reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0)
      },
      hint: game.i18n.localize("TREASURE_CHEST.Sheet.Hint"),
      lootingBlocked,
      canTake,
      sealed: Boolean(sealed),
      sealedText,
      security: {
        ...security,
        ...securityFormOptions(security),
        trapName: game.i18n.localize(`TREASURE_CHEST.Security.Presets.${security.preset}`),
        showPanel: this.isEditable || security.locked || security.trapped,
        showLockDetails: security.locked,
        showTrapDetails: security.trapped,
        heading: game.i18n.localize(security.trapped
          ? "TREASURE_CHEST.Security.Title"
          : "TREASURE_CHEST.Security.LockTitle"),
        showExamine,
        showUnderstand,
        understandLabel: game.i18n.localize(security.understandSkill === "arc"
          ? "TREASURE_CHEST.Security.UnderstandArcana"
          : "TREASURE_CHEST.Security.UnderstandInvestigation"),
        showDisarm,
        showUnlock,
        showRequests: showExamine || showUnderstand || showDisarm || showUnlock,
        unlockBlocked: armed && security.detected
      },
      denominations: DENOMINATIONS.map((key) => ({
        key,
        label: key.toUpperCase(),
        icon: CONFIG.DND5E?.currencies?.[key]?.icon ?? "",
        value: currency[key],
        takeLabel: game.i18n.format("TREASURE_CHEST.Actions.TakeDenom", { denom: key.toUpperCase() })
      })),
      columns: {
        quantity: localizeOr("DND5E.Quantity", "Quantity"),
        weight: localizeOr("DND5E.Weight", "Weight"),
        price: localizeOr("DND5E.Price", "Price")
      },
      sections: SECTION_ORDER.map((id) => ({
        id,
        label: localizeOr(...SECTION_LABELS[id]),
        count: grouped[id].length,
        items: grouped[id].map((entry) => ({
          ...entry,
          rarity: rarityText(entry),
          weight: weightText(entry),
          price: priceText(entry)
        }))
      }))
    };
  }

  /** @override */
  _onRender(context, options) {
    super._onRender?.(context, options);
    this.#bindDropZone();
    this.#bindRowDrag();
    this.#bindItemKeys();
    const nameInput = this.element.querySelector("input.document-name");
    if (nameInput && nameInput !== document.activeElement) nameInput.value = this.document.name ?? "";
    const portrait = chestPortrait(this.document);
    const image = this.element.querySelector(".profile-img");
    if (image) image.src = portrait;
    if (this.isEditable && needsDefaultPortrait(this.document)) {
      void this.document.update({ img: portrait });
    }
  }

  #bindDropZone() {
    const dropZone = this.element.querySelector(".chest-drop-zone");
    if (!dropZone || !this.isEditable || dropZone.dataset.bound === "1") return;
    dropZone.dataset.bound = "1";

    dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropZone.classList.add("drag-over");
    });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
    dropZone.addEventListener("drop", async (event) => {
      event.preventDefault();
      dropZone.classList.remove("drag-over");
      await this.#handleDrop(event);
    });
  }

  #bindRowDrag() {
    const zone = this.element.querySelector(".chest-drop-zone");
    if (!zone || zone.dataset.dragBound === "1") return;
    zone.dataset.dragBound = "1";
    zone.addEventListener("dragstart", (event) => {
      const row = event.target.closest?.("[data-entry-id]");
      if (!row || row.getAttribute("draggable") !== "true") return;
      if (event.target.closest("button, input, select, textarea")) {
        event.preventDefault();
        return;
      }
      const payload = {
        type: "TreasureChestEntry",
        chestUuid: this.document.uuid,
        entryId: row.dataset.entryId
      };
      event.dataTransfer?.setData("text/plain", JSON.stringify(payload));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    });
  }

  /** @param {DragEvent} event */
  async #handleDrop(event) {
    const data = foundry.applications.ux.TextEditor.getDragEventData(event);
    if (!data?.uuid) return;
    const doc = await foundry.utils.fromUuid(data.uuid);
    if (!doc || doc.documentName !== "Item") return;
    await addDocumentToChest(this.document, doc);
  }

  /**
   * @param {string} subject
   * @returns {Promise<{ actor: Actor, placeId: string }|null>}
   */
  async #chooseDestination(subject) {
    const actor = lootRecipient();
    if (!actor) return null;
    return chooseLootPlace(actor, subject);
  }

  static async #onSubmit(event, form, formData) {
    const sheet = /** @type {ChestSheet} */ (this);
    if (!sheet.isEditable) return;
    const raw = formData.object ?? {};
    const update = {};
    if (typeof raw.name === "string" && raw.name.trim()) update.name = raw.name.trim();
    const hiddenInput = form.querySelector('[name="hidden"]');
    if (hiddenInput) update[`flags.${MODULE_ID}.hidden`] = hiddenInput.checked;
    if (raw.currency) {
      const currency = {};
      for (const key of DENOMINATIONS) currency[key] = Math.max(0, Math.floor(Number(raw.currency[key]) || 0));
      update[`flags.${MODULE_ID}.currency`] = currency;
    }
    if (form.querySelector('[name="security.locked"]')) {
      update[`flags.${MODULE_ID}.security`] = securityFromForm(form, getSecurity(sheet.document));
    }
    if (Object.keys(update).length) await sheet.document.update(update);
  }

  static async #onEditImage() {
    const sheet = /** @type {ChestSheet} */ (this);
    if (!sheet.isEditable) return;
    const Picker = foundry.applications?.apps?.FilePicker?.implementation
      ?? foundry.applications?.apps?.FilePicker
      ?? globalThis.FilePicker;
    new Picker({
      type: "image",
      current: sheet.document.img,
      callback: async (path) => {
        if (!path || path === sheet.document.img) return;
        await sheet.document.update({ img: path });
        const image = sheet.element?.querySelector(".profile-img");
        if (image) image.src = path;
      }
    }).render(true);
  }

  static async #onBrowse() {
    const sheet = /** @type {ChestSheet} */ (this);
    if (!sheet.isEditable) return;
    const { ItemBrowserDialog } = await import("./item-browser.js");
    new ItemBrowserDialog({ chest: sheet.document }).render(true);
  }

  static async #onTakeItem(event, target) {
    const sheet = /** @type {ChestSheet} */ (this);
    const entryId = target.closest("[data-entry-id]")?.dataset?.entryId;
    if (!entryId) return;
    const entry = getContents(sheet.document).find((row) => row.id === entryId);
    const dest = await sheet.#chooseDestination(entry?.name ?? "");
    if (!dest) return;
    await takeItem(sheet.document, entryId, dest.actor, dest.placeId);
  }

  static async #onTakeDenom(event, target) {
    const sheet = /** @type {ChestSheet} */ (this);
    const denom = target.dataset.denom;
    if (!DENOMINATIONS.includes(denom)) return;
    const dest = await sheet.#chooseDestination(game.i18n.format("TREASURE_CHEST.Actions.TakeDenom", { denom: denom.toUpperCase() }));
    if (!dest) return;
    await takeCurrency(sheet.document, dest.actor, dest.placeId, denom);
  }

  static async #onTakeCoins() {
    const sheet = /** @type {ChestSheet} */ (this);
    const dest = await sheet.#chooseDestination(game.i18n.localize("TREASURE_CHEST.Prompt.Coins"));
    if (!dest) return;
    await takeCurrency(sheet.document, dest.actor, dest.placeId, null);
  }

  static async #onTakeAll() {
    const sheet = /** @type {ChestSheet} */ (this);
    const dest = await sheet.#chooseDestination(game.i18n.localize("TREASURE_CHEST.Prompt.Everything"));
    if (!dest) return;
    await takeAll(sheet.document, dest.actor, dest.placeId);
  }

  static async #onExamine() {
    const sheet = /** @type {ChestSheet} */ (this);
    await requestCheck(sheet.document, "examine");
  }

  static async #onUnderstand() {
    const sheet = /** @type {ChestSheet} */ (this);
    await requestCheck(sheet.document, "understand");
  }

  static async #onDisarm() {
    const sheet = /** @type {ChestSheet} */ (this);
    await requestCheck(sheet.document, "disarm");
  }

  static async #onUnlock() {
    const sheet = /** @type {ChestSheet} */ (this);
    if (sheet.#unlockBlocked()) return;
    await requestCheck(sheet.document, "unlock");
  }

  static async #onForce() {
    const sheet = /** @type {ChestSheet} */ (this);
    if (sheet.#unlockBlocked()) return;
    await requestCheck(sheet.document, "unlock");
  }

  /** @returns {boolean} */
  #unlockBlocked() {
    const security = getSecurity(this.document);
    const armed = security.trapped && !security.disarmed && !security.triggered;
    if (armed && security.detected) {
      ui.notifications.warn(game.i18n.localize("TREASURE_CHEST.Notifications.DisarmFirst"));
      return true;
    }
    return false;
  }

  /** Enter or Space on a focused item name does the same as a click. */
  #bindItemKeys() {
    for (const element of this.element.querySelectorAll("[data-action='showItem']")) {
      if (element.dataset.keyBound === "1") continue;
      element.dataset.keyBound = "1";
      element.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        element.click();
      });
    }
  }

  static async #onShowItem(event, target) {
    const sheet = /** @type {ChestSheet} */ (this);
    const entryId = target.closest("[data-entry-id]")?.dataset?.entryId;
    if (!entryId) return;
    const entry = getContents(sheet.document).find((row) => row.id === entryId);
    if (entry) await showItemDetails(entry);
  }

  static async #onRemoveItem(event, target) {
    const sheet = /** @type {ChestSheet} */ (this);
    if (!sheet.isEditable) return;
    const entryId = target.closest("[data-entry-id]")?.dataset?.entryId;
    if (!entryId) return;
    const entry = getContents(sheet.document).find((row) => row.id === entryId);
    await setContents(sheet.document, getContents(sheet.document).filter((row) => row.id !== entryId));
    if (entry) {
      ui.notifications.info(game.i18n.format("TREASURE_CHEST.Notifications.Removed", { name: entry.name }));
    }
  }
}

/**
 * @param {object} entry
 * @returns {string}
 */
function rarityText(entry) {
  const rarity = entry?.data?.system?.rarity;
  if (!rarity || rarity === "common") return "";
  const label = CONFIG.DND5E?.itemRarity?.[rarity];
  if (typeof label === "string") return game.i18n.localize(label);
  if (typeof label?.label === "string") return game.i18n.localize(label.label);
  return String(rarity);
}

/**
 * Translate a key, falling back to plain English if the key does not exist.
 * @param {string} key
 * @param {string} fallback
 * @returns {string}
 */
function localizeOr(key, fallback) {
  const text = game.i18n.localize(key);
  return text === key ? fallback : text;
}

/**
 * Weight of one item, e.g. "3 lb". Empty when it weighs nothing.
 * dnd5e 4+ stores { value, units }; older versions store a bare number.
 * @param {object} entry
 * @returns {string}
 */
function weightText(entry) {
  const raw = entry?.data?.system?.weight;
  const isObject = raw !== null && typeof raw === "object";
  const value = Number(isObject ? raw.value : raw);
  if (!Number.isFinite(value) || value <= 0) return "";
  return isObject && raw.units ? `${value} ${raw.units}` : String(value);
}

/**
 * Price of one item, e.g. "25 gp". Empty when it has no price.
 * @param {object} entry
 * @returns {string}
 */
function priceText(entry) {
  const price = entry?.data?.system?.price;
  const value = Number(price?.value);
  if (!Number.isFinite(value) || value <= 0) return "";
  return `${value} ${price.denomination ?? "gp"}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

/**
 * Open a read-only window describing one chest entry. The entry is a stored
 * snapshot, not a real Item, so this reads the snapshot directly.
 * @param {object} entry
 * @returns {Promise<void>}
 */
async function showItemDetails(entry) {
  const id = `treasure-chest-details-${entry.id}`;
  const open = foundry.applications.instances.get(id);
  if (open) {
    open.bringToFront?.();
    return;
  }

  const data = entry.data ?? {};
  const system = data.system ?? {};
  const type = String(data.type ?? "loot");
  const meta = [localizeOr(`TYPES.Item.${type}`, type), rarityText(entry)].filter(Boolean).join(", ");
  const facts = [
    [localizeOr("DND5E.Quantity", "Quantity"), String(entry.quantity ?? 1)],
    [localizeOr("DND5E.Weight", "Weight"), weightText(entry)],
    [localizeOr("DND5E.Price", "Price"), priceText(entry)]
  ].filter(([, value]) => value);

  // Players do not see GM secrets in the description.
  const TextEditor = foundry.applications.ux.TextEditor.implementation ?? foundry.applications.ux.TextEditor;
  const description = await TextEditor.enrichHTML(String(system.description?.value ?? ""), {
    secrets: game.user.isGM
  });

  const content = `
    <div class="item-details">
      <header class="item-details-header" data-rarity="${escapeHtml(system.rarity)}">
        <img src="${escapeHtml(entry.img)}" alt="">
        <div class="item-details-title">
          <h2>${escapeHtml(entry.name)}</h2>
          ${meta ? `<p>${escapeHtml(meta)}</p>` : ""}
        </div>
      </header>
      ${facts.length ? `<ul class="item-details-facts">${facts
    .map(([label, value]) => `<li><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></li>`)
    .join("")}</ul>` : ""}
      <div class="item-details-description">${description}</div>
    </div>`;

  const dialog = new foundry.applications.api.DialogV2({
    id,
    classes: ["treasure-chest", "treasure-chest-details"],
    window: { title: entry.name, resizable: true },
    position: { width: 460 },
    modal: false,
    content,
    buttons: [{ action: "close", label: game.i18n.localize("Close"), default: true }]
  });
  await dialog.render({ force: true });
}
