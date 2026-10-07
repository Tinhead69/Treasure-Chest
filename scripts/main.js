import { EMPTY_CURRENCY, MODULE_ID, chestArtwork, defaultSecurity, isChest, isChestEmpty } from "./data.js";
import { ChestSheet } from "./chest-sheet.js";
import { registerLootDrop } from "./loot.js";
import { registerSceneHooks } from "./scene.js";
import { handleSecuritySocket, registerCheckRequests } from "./security.js";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "deleteWhenEmpty", {
    name: "TREASURE_CHEST.Settings.DeleteWhenEmpty.Name",
    hint: "TREASURE_CHEST.Settings.DeleteWhenEmpty.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  foundry.applications.handlebars.loadTemplates([
    "modules/treasure-chest/templates/chest-sheet.hbs",
    "modules/treasure-chest/templates/item-browser.hbs"
  ]);

  foundry.documents.collections.Items.registerSheet(MODULE_ID, ChestSheet, {
    types: ["loot"],
    label: "Treasure Chest",
    makeDefault: false
  });

  registerSceneHooks();
  registerLootDrop();
  registerCheckRequests();
});

Hooks.once("ready", () => {
  game.socket.on(`module.${MODULE_ID}`, onSocketMessage);
});

/**
 * @param {{ action?: string, uuid?: string }} message
 */
async function onSocketMessage(message) {
  if (handleSecuritySocket(message)) return;
  if (!game.user.isGM || message?.action !== "deleteIfEmpty" || !message.uuid) return;
  if (!game.settings.get(MODULE_ID, "deleteWhenEmpty")) return;
  const item = await foundry.utils.fromUuid(message.uuid);
  if (!item || !isChest(item) || !isChestEmpty(item)) return;
  const name = item.name;
  await item.delete();
  ui.notifications.info(game.i18n.format("TREASURE_CHEST.Notifications.Deleted", { name }));
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
 * @returns {Promise<boolean|null>}
 */
async function chooseTrapped() {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) return false;

  const content = `
    <p>${escapeHtml(game.i18n.localize("TREASURE_CHEST.Create.KindBody"))}</p>
    <div class="treasure-chest-kind">
      <label>
        <input type="radio" name="kind" value="plain" checked>
        ${escapeHtml(game.i18n.localize("TREASURE_CHEST.Create.Plain"))}
      </label>
      <label>
        <input type="radio" name="kind" value="trapped">
        ${escapeHtml(game.i18n.localize("TREASURE_CHEST.Create.Trapped"))}
      </label>
    </div>`;

  let result = null;
  try {
    const config = {
      window: { title: game.i18n.localize("TREASURE_CHEST.Create.KindTitle") },
      content,
      rejectClose: false,
      ok: { label: game.i18n.localize("TREASURE_CHEST.Create.Confirm") }
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
    console.warn("Treasure Chest | Chest type prompt closed", error);
    return null;
  }

  const kind = result?.kind ?? result?.object?.kind;
  if (kind !== "plain" && kind !== "trapped") return null;
  return kind === "trapped";
}

/**
 * @param {object} [options]
 * @param {string|null} [options.folder]
 * @returns {Promise<Item|null>}
 */
async function createChest({ folder = null } = {}) {
  const trapped = await chooseTrapped();
  if (trapped === null) return null;
  const security = defaultSecurity();
  security.trapped = trapped;

  const ownership = foundry.CONST?.DOCUMENT_OWNERSHIP_LEVELS ?? CONST?.DOCUMENT_OWNERSHIP_LEVELS;
  const observer = ownership?.OBSERVER ?? 2;
  const item = await foundry.documents.Item.implementation.create({
    name: game.i18n.localize("TREASURE_CHEST.Create.DefaultName"),
    type: "loot",
    img: chestArtwork(),
    folder,
    ownership: { default: observer },
    flags: {
      [MODULE_ID]: {
        isChest: true,
        currency: { ...EMPTY_CURRENCY },
        contents: [],
        security
      },
      core: { sheetClass: `${MODULE_ID}.ChestSheet` }
    }
  });
  ui.notifications.info(game.i18n.format("TREASURE_CHEST.Create.Created", { name: item.name }));
  item.sheet?.render(true);
  return item;
}

/** @param {HTMLElement|jQuery|null} htmlOrElement */
function resolveAppElement(htmlOrElement) {
  if (!htmlOrElement) return null;
  if (htmlOrElement instanceof HTMLElement) return htmlOrElement;
  if (htmlOrElement[0] instanceof HTMLElement) return htmlOrElement[0];
  return null;
}

/**
 * @param {Application} app
 * @param {HTMLElement|jQuery} htmlOrElement
 */
function injectChestChoice(app, htmlOrElement) {
  try {
    const title = String(app?.title ?? app?.options?.window?.title ?? "");
    const isCreateItem =
      /Create New Item/i.test(title) ||
      (app?.documentName === "Item" && /create/i.test(app?.constructor?.name ?? ""));
    if (!isCreateItem && !app?.element?.querySelector?.('input[name="type"][value="loot"]')) return;

    const root = resolveAppElement(htmlOrElement) ?? app?.element ?? null;
    if (!root || root.querySelector(".treasure-chest-choice")) return;

    const lootInput =
      root.querySelector('input[name="type"][value="loot"]') ??
      root.querySelector('input[value="loot"]');
    const lootLabel = lootInput?.closest("label") ?? lootInput?.parentElement;
    if (!lootLabel) return;

    const chestLabel = lootLabel.cloneNode(true);
    chestLabel.classList.add("treasure-chest-choice");
    const input = chestLabel.querySelector('input[name="type"], input[type="radio"]');
    if (!input) return;
    input.value = "__treasure_chest__";
    input.checked = false;
    const image = chestLabel.querySelector("img");
    if (image) {
      image.src = chestArtwork();
      image.alt = "";
    }
    const typeName = game.i18n.localize("TREASURE_CHEST.Create.Type");
    const caption = [...chestLabel.querySelectorAll("span")].find((span) => !span.querySelector("img, input"));
    if (caption) caption.textContent = typeName;
    const anchor = root.querySelector(".npc-spellbook-choice") ?? lootLabel;
    anchor.after(chestLabel);

    const form = root.querySelector("form") ?? root;
    const onCreate = async (event) => {
      const selected = form.querySelector('input[name="type"]:checked')?.value;
      if (selected !== "__treasure_chest__") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const folder = form.querySelector('[name="folder"]')?.value || null;
      const item = await createChest({ folder });
      if (item) app.close();
    };

    form.addEventListener("submit", onCreate, true);
    root.querySelectorAll('button[type="submit"], button[data-action="create"]').forEach((button) => {
      button.addEventListener("click", onCreate, true);
    });
  } catch (error) {
    console.error("Treasure Chest | Failed to patch the create item dialog", error);
  }
}

Hooks.on("renderDialog", (app, html) => injectChestChoice(app, html));
Hooks.on("renderApplicationV2", (app, element) => injectChestChoice(app, element));

Hooks.on("renderItemDirectory", (app, htmlOrElement) => {
  if (!game.user.isGM) return;
  const root = resolveAppElement(htmlOrElement) ?? app?.element;
  if (!root || root.querySelector(".treasure-chest-create")) return;

  const header =
    root.querySelector(".directory-header .header-actions") ??
    root.querySelector(".header-actions") ??
    root.querySelector(".directory-header");
  if (!header) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "treasure-chest-create";
  button.title = game.i18n.localize("TREASURE_CHEST.Create.Button");
  button.innerHTML = `<i class="fas fa-box-open"></i>`;
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    await createChest();
  });
  header.append(button);
});
