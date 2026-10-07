import { MODULE_ID, chestPortrait, isChest } from "./data.js";

/**
 * @param {string} uuid
 * @returns {Promise<void>}
 */
export async function removeChestTiles(uuid) {
  for (const scene of game.scenes) {
    const ids = scene.tiles
      .filter((tile) => tile.getFlag(MODULE_ID, "chestUuid") === uuid)
      .map((tile) => tile.id);
    if (ids.length) await scene.deleteEmbeddedDocuments("Tile", ids);
  }
}

/**
 * @param {Item} item
 * @returns {Promise<void>}
 */
export async function syncChestTileImages(item) {
  const src = chestPortrait(item);
  for (const scene of game.scenes) {
    const updates = scene.tiles
      .filter((tile) => tile.getFlag(MODULE_ID, "chestUuid") === item.uuid)
      .map((tile) => ({ _id: tile.id, texture: { src } }));
    if (updates.length) await scene.updateEmbeddedDocuments("Tile", updates);
  }
}

/**
 * @param {Canvas} canvas
 * @param {Item} item
 * @param {number} x
 * @param {number} y
 * @returns {Promise<void>}
 */
async function placeChest(canvas, item, x, y) {
  const scene = canvas.scene;
  if (!scene) return;
  const size = scene.grid?.size || 100;
  const src = chestPortrait(item);
  const existing = scene.tiles.find((tile) => tile.getFlag(MODULE_ID, "chestUuid") === item.uuid);

  if (existing) {
    const width = existing.width || size;
    const height = existing.height || size;
    await existing.update({
      x: x - width / 2,
      y: y - height / 2,
      "texture.src": src
    });
    return;
  }

  await scene.createEmbeddedDocuments("Tile", [{
    x: x - size / 2,
    y: y - size / 2,
    width: size,
    height: size,
    texture: { src },
    flags: { [MODULE_ID]: { chestUuid: item.uuid } }
  }]);
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
    item = fromUuidSync(data.uuid);
  } catch (error) {
    console.error("Treasure Chest | Could not read dropped item", error);
    return;
  }
  if (!isChest(item)) return;
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("TREASURE_CHEST.Notifications.GmPlaceOnly"));
    return false;
  }
  if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) return false;

  placeChest(canvas, item, data.x, data.y).catch((error) => {
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
    removeChestTiles(item.uuid).catch((error) => {
      console.error("Treasure Chest | Failed to remove scene markers", error);
    });
  });

  Hooks.on("updateItem", (item, changes) => {
    if (!game.user.isGM || !isChest(item) || changes.img === undefined) return;
    syncChestTileImages(item).catch((error) => {
      console.error("Treasure Chest | Failed to update scene marker", error);
    });
  });
}
