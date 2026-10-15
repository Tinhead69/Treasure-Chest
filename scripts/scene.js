import { MODULE_ID, chestArtwork, isChest, isChestHidden } from "./data.js";

const HOVER_NAME = () => foundry.CONST.TOKEN_DISPLAY_MODES.HOVER;
const HIDE_BARS = () => foundry.CONST.TOKEN_DISPLAY_MODES.NONE;

/**
 * @returns {Promise<Folder|null>}
 */
async function markerFolder() {
  const existing = game.folders?.find((folder) => folder.type === "Actor" && folder.getFlag(MODULE_ID, "markers"));
  if (existing) return existing;
  return foundry.documents.Folder.create({
    name: "Treasure Chests",
    type: "Actor",
    flags: { [MODULE_ID]: { markers: true } }
  });
}

/**
 * One actor per chest, used only so the map marker can be a token.
 * @param {Item} item
 * @returns {Promise<Actor>}
 */
async function markerActor(item) {
  const src = item.img || chestArtwork();
  let actor = game.actors.find((entry) => entry.getFlag(MODULE_ID, "chestUuid") === item.uuid);
  if (actor) {
    const updates = {};
    if (actor.name !== item.name) updates.name = item.name;
    if (actor.img !== src) updates.img = src;
    if (actor.prototypeToken?.texture?.src !== src) updates["prototypeToken.texture.src"] = src;
    if (Boolean(actor.prototypeToken?.hidden) !== isChestHidden(item)) updates["prototypeToken.hidden"] = isChestHidden(item);
    if (Object.keys(updates).length) await actor.update(updates);
    return actor;
  }

  const folder = await markerFolder();
  const none = foundry.CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
  return foundry.documents.Actor.create({
    name: item.name,
    type: "npc",
    img: src,
    folder: folder?.id ?? null,
    ownership: { default: none },
    prototypeToken: {
      name: item.name,
      actorLink: true,
      texture: { src },
      width: 1,
      height: 1,
      displayName: HOVER_NAME(),
      displayBars: HIDE_BARS(),
      sight: { enabled: false },
      hidden: isChestHidden(item),
      disposition: foundry.CONST.TOKEN_DISPOSITIONS.NEUTRAL
    },
    flags: { [MODULE_ID]: { chestUuid: item.uuid, marker: true } }
  });
}

/**
 * @param {string} uuid
 * @returns {Promise<void>}
 */
export async function removeChestMarkers(uuid) {
  for (const scene of game.scenes) {
    const tileIds = scene.tiles
      .filter((tile) => tile.getFlag(MODULE_ID, "chestUuid") === uuid)
      .map((tile) => tile.id);
    if (tileIds.length) await scene.deleteEmbeddedDocuments("Tile", tileIds);
    const tokenIds = scene.tokens
      .filter((token) => token.getFlag(MODULE_ID, "chestUuid") === uuid)
      .map((token) => token.id);
    if (tokenIds.length) await scene.deleteEmbeddedDocuments("Token", tokenIds);
  }
  const actors = game.actors.filter((actor) => actor.getFlag(MODULE_ID, "chestUuid") === uuid);
  if (actors.length) await foundry.documents.Actor.deleteDocuments(actors.map((actor) => actor.id));
}

/**
 * @param {Item} item
 * @returns {Promise<void>}
 */
export async function syncChestMarkers(item) {
  const src = item.img || chestArtwork();
  await markerActor(item);
  for (const scene of game.scenes) {
    const tokenUpdates = scene.tokens
      .filter((token) => token.getFlag(MODULE_ID, "chestUuid") === item.uuid)
      .map((token) => ({
        _id: token.id,
        name: item.name,
        hidden: isChestHidden(item),
        "texture.src": src
      }));
    if (tokenUpdates.length) await scene.updateEmbeddedDocuments("Token", tokenUpdates);
    const tileUpdates = scene.tiles
      .filter((tile) => tile.getFlag(MODULE_ID, "chestUuid") === item.uuid)
      .map((tile) => ({ _id: tile.id, "texture.src": src }));
    if (tileUpdates.length) await scene.updateEmbeddedDocuments("Tile", tileUpdates);
  }
}

/**
 * @param {Scene} scene
 * @param {Item} item
 * @param {number} x
 * @param {number} y
 * @returns {Promise<void>}
 */
async function createChestToken(scene, item, x, y) {
  const size = scene.grid?.size || 100;
  const src = item.img || chestArtwork();
  const actor = await markerActor(item);
  const existing = scene.tokens.find((token) => token.getFlag(MODULE_ID, "chestUuid") === item.uuid);
  const position = {
    x: x - size / 2,
    y: y - size / 2,
    name: item.name,
    hidden: isChestHidden(item),
    "texture.src": src
  };
  if (existing) {
    await existing.update(position);
    return;
  }
  await scene.createEmbeddedDocuments("Token", [{
    name: item.name,
    actorId: actor.id,
    x: position.x,
    y: position.y,
    width: 1,
    height: 1,
    texture: { src },
    actorLink: true,
    displayName: HOVER_NAME(),
    displayBars: HIDE_BARS(),
    sight: { enabled: false },
    hidden: isChestHidden(item),
    flags: { [MODULE_ID]: { chestUuid: item.uuid } }
  }]);
}

/**
 * Turn older tile markers into tokens so they can be dragged.
 * @param {Scene} scene
 * @returns {Promise<void>}
 */
async function migrateTiles(scene) {
  const tiles = scene.tiles.filter((tile) => tile.getFlag(MODULE_ID, "chestUuid"));
  for (const tile of tiles) {
    const uuid = tile.getFlag(MODULE_ID, "chestUuid");
    const item = await foundry.utils.fromUuid(uuid);
    if (item && isChest(item)) {
      const size = scene.grid?.size || 100;
      await createChestToken(scene, item, tile.x + (tile.width || size) / 2, tile.y + (tile.height || size) / 2);
    }
    await tile.delete();
  }
}

/**
 * @param {Canvas} canvas
 * @param {object} data
 * @returns {boolean|void}
 */
function onDropCanvasData(canvas, data) {
  if (data?.type !== "Item" || !data.uuid) return;
  let item = null;
  try {
    item = foundry.utils.fromUuidSync(data.uuid);
  } catch (error) {
    console.error("Treasure Chest | Could not read dropped item", error);
    return;
  }
  if (!isChest(item)) return;
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("TREASURE_CHEST.Notifications.GmPlaceOnly"));
    return false;
  }
  if (!Number.isFinite(data.x) || !Number.isFinite(data.y) || !canvas.scene) return false;

  createChestToken(canvas.scene, item, data.x, data.y).catch((error) => {
    console.error("Treasure Chest | Failed to place chest", error);
  });
  return false;
}

/** @type {HTMLElement|null} */
let boundView = null;

/**
 * @param {MouseEvent} event
 * @returns {{ x: number, y: number }|null}
 */
function clientToCanvas(event) {
  const point = { x: event.clientX, y: event.clientY };
  if (typeof canvas.canvasCoordinatesFromClient === "function") {
    const coords = canvas.canvasCoordinatesFromClient(event) ?? canvas.canvasCoordinatesFromClient(point);
    if (coords && Number.isFinite(coords.x) && Number.isFinite(coords.y)) return coords;
  }

  const view = canvas.app?.canvas ?? canvas.app?.view;
  if (!view) return null;
  const rect = view.getBoundingClientRect();
  const transform = canvas.stage?.worldTransform;
  const scaleX = transform?.a || 1;
  const scaleY = transform?.d || 1;
  return {
    x: (event.clientX - rect.left - (transform?.tx ?? 0)) / scaleX,
    y: (event.clientY - rect.top - (transform?.ty ?? 0)) / scaleY
  };
}

/**
 * @param {PIXI.Container|object} tile
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function tileContains(tile, x, y) {
  if (typeof tile.bounds?.contains === "function") return tile.bounds.contains(x, y);
  const document = tile.document;
  return x >= document.x && y >= document.y && x <= document.x + document.width && y <= document.y + document.height;
}

/**
 * @param {MouseEvent} event
 */
function onCanvasDblClick(event) {
  if (!canvas?.tiles || !canvas.scene) return;
  const view = canvas.app?.canvas ?? canvas.app?.view;
  if (view && event.target !== view && !view.contains?.(event.target)) return;

  const coords = clientToCanvas(event);
  if (!coords) return;

  const hits = canvas.tiles.placeables.filter((tile) => {
    const uuid = tile.document.getFlag(MODULE_ID, "chestUuid");
    if (!uuid) return false;
    if (tile.document.hidden && !game.user.isGM) return false;
    return tileContains(tile, coords.x, coords.y);
  });
  if (!hits.length) return;

  hits.sort((a, b) => (a.document.sort ?? 0) - (b.document.sort ?? 0));
  const uuid = hits.at(-1).document.getFlag(MODULE_ID, "chestUuid");
  event.preventDefault();
  event.stopPropagation();
  openPlacedChest(uuid);
}

/**
 * @param {string} uuid
 * @returns {Promise<void>}
 */
async function openPlacedChest(uuid) {
  const item = await foundry.utils.fromUuid(uuid);
  if (!item || !isChest(item)) {
    ui.notifications.warn(game.i18n.localize("TREASURE_CHEST.Notifications.MissingChest"));
    return;
  }
  if (!game.user.isGM && isChestHidden(item)) return;
  item.sheet?.render(true);
}

function bindDoubleClick() {
  unbindDoubleClick();
  boundView = canvas.app?.canvas ?? canvas.app?.view ?? null;
  boundView?.addEventListener("dblclick", onCanvasDblClick);
}

function unbindDoubleClick() {
  boundView?.removeEventListener("dblclick", onCanvasDblClick);
  boundView = null;
}

/** Re-render open chests when the viewed scene changes, so the combat lock stays current. */
function refreshOpenChests() {
  for (const item of game.items) {
    if (isChest(item) && item.sheet?.rendered) item.sheet.render(false);
  }
}

function patchTokenDoubleClick() {
  const TokenClass = foundry.canvas?.placeables?.Token ?? CONFIG.Token?.objectClass;
  if (!TokenClass?.prototype || TokenClass.prototype._treasureChestPatched) return;
  const original = TokenClass.prototype._onClickLeft2;
  TokenClass.prototype._onClickLeft2 = function onChestDoubleClick(event) {
    const uuid = this.document?.getFlag?.(MODULE_ID, "chestUuid");
    if (uuid) {
      openPlacedChest(uuid);
      return;
    }
    return original?.call(this, event);
  };
  TokenClass.prototype._treasureChestPatched = true;
}

export function registerSceneHooks() {
  Hooks.on("dropCanvasData", onDropCanvasData);
  Hooks.on("canvasReady", () => {
    bindDoubleClick();
    refreshOpenChests();
  });
  Hooks.on("canvasTearDown", unbindDoubleClick);
  Hooks.on("combatStart", refreshOpenChests);
  Hooks.on("combatEnd", refreshOpenChests);
  Hooks.on("deleteCombat", refreshOpenChests);

  Hooks.on("deleteItem", (item) => {
    if (!game.user.isGM || !isChest(item)) return;
    removeChestMarkers(item.uuid).catch((error) => {
      console.error("Treasure Chest | Failed to remove scene markers", error);
    });
  });

  Hooks.on("updateItem", (item, changes) => {
    if (!game.user.isGM || !isChest(item)) return;
    const hiddenChanged = Object.prototype.hasOwnProperty.call(changes.flags?.[MODULE_ID] ?? {}, "hidden");
    if (changes.img === undefined && changes.name === undefined && !hiddenChanged) return;
    syncChestMarkers(item).catch((error) => {
      console.error("Treasure Chest | Failed to update chest token", error);
    });
  });

  Hooks.on("updateToken", (token, changes) => {
    if (!game.user.isGM) return;
    const uuid = token.getFlag(MODULE_ID, "chestUuid");
    if (!uuid) return;
    const item = foundry.utils.fromUuidSync(uuid);
    if (!item || !isChest(item)) return;
    const update = {};
    const src = changes?.texture?.src;
    if (src && item.img !== src) update.img = src;
    if (changes.hidden !== undefined && isChestHidden(item) !== (changes.hidden === true)) {
      update[`flags.${MODULE_ID}.hidden`] = changes.hidden === true;
    }
    if (!Object.keys(update).length) return;
    item.update(update).catch((error) => {
      console.error("Treasure Chest | Failed to copy the token onto the chest", error);
    });
  });

  Hooks.once("ready", () => {
    patchTokenDoubleClick();
    if (!game.user.isGM) return;
    for (const scene of game.scenes) {
      migrateTiles(scene).catch((error) => {
        console.error("Treasure Chest | Failed to turn a chest tile into a token", error);
      });
    }
  });
}
