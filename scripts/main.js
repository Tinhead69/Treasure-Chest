import { CHEST_ICON, EMPTY_CURRENCY, MODULE_ID, defaultSecurity, isChest, isChestEmpty } from "./data.js";
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

  Items.registerSheet(MODULE_ID, ChestSheet, {
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
  const item = await fromUuid(message.uuid);
  if (!item || !isChest(item) || !isChestEmpty(item)) return;
  const name = item.name;
  await item.delete();
  ui.notifications.info(game.i18n.format("TREASURE_CHEST.Notifications.Deleted", { name }));
}

/**
 * @param {object} [options]
 * @param {string|null} [options.folder]
 * @returns {Promise<Item>}
 */
async function createChest({ folder = null } = {}) {
  const ownership = foundry.CONST?.DOCUMENT_OWNERSHIP_LEVELS ?? CONST?.DOCUMENT_OWNERSHIP_LEVELS;
  const observer = ownership?.OBSERVER ?? 2;
  const item = await Item.implementation.create({
    name: game.i18n.localize("TREASURE_CHEST.Create.DefaultName"),
    type: "loot",
    img: CHEST_ICON,
    folder,
    ownership: { default: observer },
    flags: {
      [MODULE_ID]: {
        isChest: true,
        currency: { ...EMPTY_CURRENCY },
        contents: [],
        security: defaultSecurity()
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

    const chestLabel = document.createElement("label");
    chestLabel.className = "treasure-chest-choice";
    chestLabel.innerHTML = `
      <input type="radio" name="type" value="__treasure_chest__">
      <span class="treasure-chest-choice-content">
        <img src="${CHEST_ICON}" alt="">
        <span class="treasure-chest-choice-text">${game.i18n.localize("TREASURE_CHEST.Create.Type")}</span>
      </span>
    `;
    const anchor = root.querySelector(".npc-spellbook-choice") ?? lootLabel;
    anchor.after(chestLabel);

    const form = root.querySelector("form") ?? root;
    const onCreate = async (event) => {
      const selected = form.querySelector('input[name="type"]:checked')?.value;
      if (selected !== "__treasure_chest__") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const folder = form.querySelector('[name="folder"]')?.value || null;
      await createChest({ folder });
      app.close();
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
