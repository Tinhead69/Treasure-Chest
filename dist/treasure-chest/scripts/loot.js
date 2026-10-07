import {
  DENOMINATIONS,
  GEAR_TYPES,
  MODULE_ID,
  asCoins,
  getContents,
  getCurrency,
  hasCoins,
  isChest,
  isChestEmpty,
  sealReason,
  setContents,
  setCurrency
} from "./data.js";

/**
 * @param {Scene|null|undefined} scene
 * @returns {boolean}
 */
export function isSceneInCombat(scene) {
  if (!scene || !game.combats) return false;
  return game.combats.some((combat) => combat.started && combat.scene?.id === scene.id);
}

/**
 * Block loot while the viewed scene is in combat, and while this chest
 * sits on a scene that has a started combat.
 * @param {Item} chest
 * @returns {boolean}
 */
export function isLootBlocked(chest) {
  if (isSceneInCombat(canvas?.scene)) return true;
  if (!chest) return false;
  for (const scene of game.scenes ?? []) {
    const placed = scene.tiles?.some((tile) => tile.getFlag(MODULE_ID, "chestUuid") === chest.uuid);
    if (placed && isSceneInCombat(scene)) return true;
  }
  return false;
}

/**
 * @returns {Actor[]}
 */
export function getDestinationActors() {
  const types = new Set(["character", "npc", "group"]);
  return game.actors
    .filter((actor) => types.has(actor.type) && actor.isOwner)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {Actor} actor
 * @returns {Item[]}
 */
export function getContainers(actor) {
  if (!actor?.items) return [];
  return actor.items
    .filter((item) => item.type === "container" || item.type === "backpack")
    .sort((a, b) => a.name.localeCompare(b.name));
}

const BAG_TOKENS = [
  "bag of holding",
  "bag-of-holding",
  "bagofholding",
  "handy haversack",
  "handy-haversack",
  "portable hole",
  "portable-hole"
];

/**
 * @param {Item} item
 * @returns {boolean}
 */
export function isBagOfHolding(item) {
  if (!item || (item.type !== "container" && item.type !== "backpack")) return false;
  const source = item.getFlag?.("core", "sourceId") ?? "";
  const text = `${item.name ?? ""} ${item.system?.identifier ?? ""} ${source}`.toLowerCase();
  return BAG_TOKENS.some((token) => text.includes(token));
}

/**
 * @param {Item} item
 * @returns {boolean}
 */
export function isSharedContainer(item) {
  if (!item || (item.type !== "container" && item.type !== "backpack")) return false;
  const text = `${item.name ?? ""} ${item.system?.identifier ?? ""}`.toLowerCase();
  return text.includes("shared") || text.includes("party");
}

/**
 * @param {Actor} actor
 * @returns {Actor[]}
 */
function sharedActors(actor) {
  return game.actors
    .filter((candidate) => candidate.id !== actor?.id && candidate.isOwner && candidate.type === "group")
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {Actor} actor
 * @returns {{ actorId: string, placeId: string, label: string, special: boolean }[]}
 */
export function listPromptPlaces(actor) {
  const places = [{
    actorId: actor.id,
    placeId: "carried",
    label: game.i18n.format("TREASURE_CHEST.Prompt.Carried", { actor: actor.name }),
    special: false
  }];

  for (const item of getContainers(actor)) {
    if (!isBagOfHolding(item) && !isSharedContainer(item)) continue;
    places.push({ actorId: actor.id, placeId: item.id, label: item.name, special: true });
  }

  for (const group of sharedActors(actor)) {
    places.push({
      actorId: group.id,
      placeId: "carried",
      label: game.i18n.format("TREASURE_CHEST.Prompt.SharedInventory", { actor: group.name }),
      special: true
    });
    for (const item of getContainers(group)) {
      places.push({
        actorId: group.id,
        placeId: item.id,
        label: `${item.name} (${group.name})`,
        special: true
      });
    }
  }

  return places;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  const text = String(value ?? "");
  if (foundry.utils.escapeHTML) return foundry.utils.escapeHTML(text);
  return text.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

/**
 * Ask where loot should go when the actor has a bag of holding or a shared container.
 * @param {Actor} actor
 * @param {string} subject
 * @returns {Promise<{ actor: Actor, placeId: string }|null>}
 */
export async function chooseLootPlace(actor, subject) {
  if (!actor) return null;
  const places = listPromptPlaces(actor);
  if (!places.some((place) => place.special)) return { actor, placeId: "carried" };

  const options = places.map((place) => {
    const value = `${place.actorId}|${place.placeId}`;
    return `<option value="${escapeHtml(value)}">${escapeHtml(place.label)}</option>`;
  }).join("");
  const content = `
    <p>${escapeHtml(game.i18n.format("TREASURE_CHEST.Prompt.Body", { name: subject }))}</p>
    <label class="treasure-chest-place">
      <span>${game.i18n.localize("TREASURE_CHEST.Prompt.Where")}</span>
      <select name="place">${options}</select>
    </label>`;

  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) return { actor, placeId: "carried" };

  let result = null;
  try {
    const config = {
      window: { title: game.i18n.format("TREASURE_CHEST.Prompt.Title", { name: subject }) },
      content,
      rejectClose: false,
      ok: { label: game.i18n.localize("TREASURE_CHEST.Prompt.Ok") }
    };
    if (DialogV2.input) result = await DialogV2.input(config);
    else {
      result = await DialogV2.wait({
        window: config.window,
        content,
        rejectClose: false,
        buttons: [{
          action: "ok",
          label: config.ok.label,
          default: true,
          callback: (_event, button) => new foundry.applications.ux.FormDataExtended(button.form).object
        }]
      });
    }
  } catch (error) {
    console.warn("Treasure Chest | Destination prompt closed", error);
    return null;
  }

  const value = result?.place ?? result?.object?.place;
  if (!value || !value.includes("|")) return null;
  const splitAt = value.indexOf("|");
  const dest = game.actors.get(value.slice(0, splitAt));
  if (!dest) return null;
  return { actor: dest, placeId: value.slice(splitAt + 1) };
}

/**
 * @param {Actor} actor
 * @param {HTMLElement} target
 * @returns {string}
 */
export function placeIdFromDropTarget(actor, target) {
  const row = target?.closest?.("[data-item-id], [data-entry-id], [data-document-id], [data-uuid], [data-item-uuid]");
  if (!row) return "carried";
  const id = row.dataset.itemId || row.dataset.entryId || row.dataset.documentId;
  let item = id ? actor.items.get(id) : null;
  if (!item) {
    const uuid = row.dataset.uuid || row.dataset.itemUuid;
    if (uuid) {
      try {
        const doc = fromUuidSync(uuid);
        if (doc?.documentName === "Item" && doc.parent?.id === actor.id) item = doc;
      } catch (error) {
        console.warn("Treasure Chest | Could not resolve drop target", error);
      }
    }
  }
  if (!item) return "carried";
  if (item.type === "container" || item.type === "backpack") return item.id;
  if (item.system?.container && actor.items.get(item.system.container)) return item.system.container;
  return "carried";
}

/**
 * @param {DragEvent} event
 * @returns {object|null}
 */
function readDragEventData(event) {
  try {
    if (foundry.applications?.ux?.TextEditor?.getDragEventData) {
      return foundry.applications.ux.TextEditor.getDragEventData(event);
    }
    return JSON.parse(event.dataTransfer?.getData("text/plain") || "null");
  } catch (error) {
    return null;
  }
}

/**
 * @param {HTMLElement} target
 * @returns {Actor|null}
 */
function actorFromElement(target) {
  const root = target?.closest?.(".application");
  if (!root) return null;
  const id = root.dataset.appid || root.id;
  const instances = foundry.applications?.instances;
  let app = null;
  if (instances?.get) {
    app = instances.get(id) ?? instances.get(Number(id)) ?? null;
    if (!app) {
      for (const candidate of instances.values()) {
        if (candidate.element === root) {
          app = candidate;
          break;
        }
      }
    }
  }
  if (!app && ui.windows) {
    app = Object.values(ui.windows).find((windowApp) => windowApp.element?.[0] === root || windowApp.element === root) ?? null;
  }
  const actor = app?.actor ?? app?.document;
  return actor?.documentName === "Actor" ? actor : null;
}

/**
 * @param {DragEvent} event
 */
async function onDocumentDrop(event) {
  const data = readDragEventData(event);
  if (data?.type !== "TreasureChestEntry") return;
  const actor = actorFromElement(event.target);
  if (!actor) return;
  event.preventDefault();
  event.stopPropagation();

  const chest = await fromUuid(data.chestUuid);
  if (!chest || !isChest(chest)) {
    ui.notifications.warn(game.i18n.localize("TREASURE_CHEST.Notifications.MissingChest"));
    return;
  }
  const placeId = placeIdFromDropTarget(actor, event.target);
  await takeItem(chest, data.entryId, actor, placeId);
}

let dropRegistered = false;

export function registerLootDrop() {
  if (dropRegistered) return;
  dropRegistered = true;
  document.addEventListener("drop", onDocumentDrop, true);
}

/**
 * @param {Item} doc
 * @returns {Iterable<Item>}
 */
function siblingItems(doc) {
  if (doc.actor?.items) return doc.actor.items;
  if (!doc.pack && doc.collection?.documentName === "Item") return doc.collection;
  if (!doc.pack) return game.items;
  return [];
}

/**
 * @param {Item} doc
 * @param {Set<string>} [seen]
 * @returns {object|null}
 */
export function snapshotFromDocument(doc, seen = new Set()) {
  const key = doc.uuid ?? doc.id;
  if (!key || seen.has(key)) return null;
  seen.add(key);

  const data = doc.toObject();
  delete data._id;
  delete data.folder;
  delete data.sort;
  delete data.ownership;
  delete data._stats;
  if (data.system) data.system.container = null;

  const contents = [];
  for (const child of siblingItems(doc)) {
    if (child.id === doc.id) continue;
    if (child.system?.container !== doc.id) continue;
    if (isChest(child)) continue;
    const snap = snapshotFromDocument(child, seen);
    if (snap) contents.push(snap);
  }

  return {
    id: foundry.utils.randomID(),
    name: doc.name,
    img: doc.img,
    quantity: Number(doc.system?.quantity ?? 1) || 1,
    data,
    contents
  };
}

/**
 * @param {Item} chest
 * @param {Item} doc
 * @returns {Promise<boolean>}
 */
export async function addDocumentToChest(chest, doc, { quiet = false } = {}) {
  if (!isChest(chest) || !doc || doc.documentName !== "Item") return false;
  if (isChest(doc) || doc.uuid === chest.uuid) {
    ui.notifications.warn(game.i18n.localize("TREASURE_CHEST.Notifications.NestedChest"));
    return false;
  }
  if (!GEAR_TYPES.has(doc.type)) {
    ui.notifications.warn(game.i18n.localize("TREASURE_CHEST.Notifications.NotGear"));
    return false;
  }

  const snap = snapshotFromDocument(doc);
  if (!snap) return false;
  const contents = getContents(chest);
  contents.push(snap);
  await setContents(chest, contents);
  if (!quiet) {
    ui.notifications.info(game.i18n.format("TREASURE_CHEST.Notifications.Added", { name: snap.name }));
  }
  return true;
}

/**
 * @param {Actor} actor
 * @param {string|null} placeId
 * @returns {{ actor: Actor, containerId: string|null, label: string }|null}
 */
function resolvePlace(actor, placeId) {
  if (!actor?.isOwner) return null;
  if (!placeId || placeId === "carried") {
    return { actor, containerId: null, label: actor.name };
  }
  const container = actor.items.get(placeId);
  if (!container) return null;
  return { actor, containerId: container.id, label: `${container.name} (${actor.name})` };
}

/**
 * @param {Actor|Item} document
 * @param {Record<string, number>} amount
 * @returns {Promise<void>}
 */
async function addCurrency(document, amount) {
  const current = document.system?.currency ?? {};
  const update = {};
  for (const key of DENOMINATIONS) {
    const coins = asCoins(amount[key]);
    if (!coins) continue;
    update[`system.currency.${key}`] = asCoins(current[key]) + coins;
  }
  if (Object.keys(update).length) await document.update(update);
}

/**
 * @param {Actor} actor
 * @param {string|null} containerId
 * @returns {Actor|Item}
 */
function currencyDocument(actor, containerId) {
  if (!containerId) return actor;
  const container = actor.items.get(containerId);
  if (container?.system && "currency" in container.system) return container;
  return actor;
}

/**
 * @param {Actor} actor
 * @param {object} entry
 * @param {string|null} containerId
 * @returns {Promise<Item>}
 */
async function createSnapshotOnActor(actor, entry, containerId) {
  const data = foundry.utils.deepClone(entry.data);
  delete data._id;
  delete data.folder;
  delete data.sort;
  delete data.ownership;
  delete data._stats;
  data.system = data.system ?? {};
  data.system.container = containerId;
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  for (const child of entry.contents ?? []) {
    await createSnapshotOnActor(actor, child, created.id);
  }
  return created;
}

/**
 * @param {Item} chest
 * @returns {Promise<void>}
 */
export async function finishLoot(chest) {
  if (!isChestEmpty(chest)) {
    chest.sheet?.render?.(false);
    return;
  }

  await chest.sheet?.close?.();
  if (!game.settings.get(MODULE_ID, "deleteWhenEmpty")) return;

  if (game.user.isGM) {
    await chest.delete();
    ui.notifications.info(game.i18n.format("TREASURE_CHEST.Notifications.Deleted", { name: chest.name }));
    return;
  }

  game.socket.emit(`module.${MODULE_ID}`, { action: "deleteIfEmpty", uuid: chest.uuid });
}

/**
 * @param {Item} chest
 * @returns {boolean}
 */
function refuseCombat(chest) {
  if (!isLootBlocked(chest)) return false;
  ui.notifications.warn(game.i18n.localize("TREASURE_CHEST.Notifications.Combat"));
  return true;
}

/**
 * @param {Item} chest
 * @returns {boolean}
 */
function refuseSealed(chest) {
  const reason = sealReason(chest);
  if (!reason) return false;
  const key = reason === "locked" ? "TREASURE_CHEST.Notifications.Locked" : "TREASURE_CHEST.Notifications.Armed";
  ui.notifications.warn(game.i18n.localize(key));
  return true;
}

/**
 * @param {Item} chest
 * @param {string} entryId
 * @param {Actor} actor
 * @param {string} placeId
 * @returns {Promise<boolean>}
 */
export async function takeItem(chest, entryId, actor, placeId, { settle = true } = {}) {
  if (refuseCombat(chest) || refuseSealed(chest)) return false;
  const place = resolvePlace(actor, placeId);
  if (!place) {
    ui.notifications.warn(game.i18n.localize("TREASURE_CHEST.Notifications.NoDestination"));
    return false;
  }
  if (place.containerId && !actor.items.get(place.containerId)) {
    ui.notifications.warn(game.i18n.localize("TREASURE_CHEST.Notifications.MissingContainer"));
    return false;
  }

  const entry = getContents(chest).find((row) => row.id === entryId);
  if (!entry) {
    ui.notifications.warn(game.i18n.localize("TREASURE_CHEST.Notifications.AlreadyTaken"));
    return false;
  }

  try {
    await createSnapshotOnActor(place.actor, entry, place.containerId);
  } catch (error) {
    console.error("Treasure Chest | Failed to give item", error);
    ui.notifications.error(game.i18n.format("TREASURE_CHEST.Notifications.TransferFailed", { name: entry.name }));
    return false;
  }

  await setContents(chest, getContents(chest).filter((row) => row.id !== entryId));
  ui.notifications.info(game.i18n.format("TREASURE_CHEST.Notifications.Took", {
    name: entry.name,
    destination: place.label
  }));
  if (settle) await finishLoot(chest);
  return true;
}

/**
 * @param {Item} chest
 * @param {Actor} actor
 * @param {string} placeId
 * @param {string|null} [denom]
 * @returns {Promise<boolean>}
 */
export async function takeCurrency(chest, actor, placeId, denom = null, { settle = true } = {}) {
  if (refuseCombat(chest) || refuseSealed(chest)) return false;
  const place = resolvePlace(actor, placeId);
  if (!place) {
    ui.notifications.warn(game.i18n.localize("TREASURE_CHEST.Notifications.NoDestination"));
    return false;
  }

  const keys = denom ? [denom] : DENOMINATIONS;
  const current = getCurrency(chest);
  const amount = {};
  for (const key of keys) {
    if (current[key] > 0) amount[key] = current[key];
  }
  if (!hasCoins(amount)) {
    ui.notifications.info(game.i18n.localize("TREASURE_CHEST.Notifications.NothingToTake"));
    return false;
  }

  await addCurrency(currencyDocument(place.actor, place.containerId), amount);
  const next = { ...current };
  for (const key of keys) next[key] = 0;
  await setCurrency(chest, next);
  ui.notifications.info(game.i18n.format("TREASURE_CHEST.Notifications.TookCoins", { destination: place.label }));
  if (settle) await finishLoot(chest);
  return true;
}

/**
 * @param {Item} chest
 * @param {Actor} actor
 * @param {string} placeId
 * @returns {Promise<boolean>}
 */
export async function takeAll(chest, actor, placeId) {
  if (refuseCombat(chest) || refuseSealed(chest)) return false;
  const contents = getContents(chest);
  const currency = getCurrency(chest);
  if (!contents.length && !hasCoins(currency)) {
    ui.notifications.info(game.i18n.localize("TREASURE_CHEST.Notifications.NothingToTake"));
    return false;
  }

  for (const entry of [...contents]) {
    const moved = await takeItem(chest, entry.id, actor, placeId, { settle: false });
    if (!moved) return false;
  }
  if (hasCoins(getCurrency(chest))) {
    const moved = await takeCurrency(chest, actor, placeId, null, { settle: false });
    if (!moved) return false;
  }
  await finishLoot(chest);
  return true;
}
