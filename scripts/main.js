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
 * @param {string} [options.name] what the person typed; blank uses the default name
 * @returns {Promise<Item|null>}
 */
async function createChest({ folder = null, name = "" } = {}) {
  const trapped = await chooseTrapped();
  if (trapped === null) return null;
  const security = defaultSecurity();
  security.trapped = trapped;

  const chestName = String(name ?? "").trim() || game.i18n.localize("TREASURE_CHEST.Create.DefaultName");
  let item = null;
  try {
    item = await createChestItem(chestName, folder, security);
  } catch (error) {
    console.error("Treasure Chest | Could not create the chest", error);
    ui.notifications.error(`Treasure Chest: could not create "${chestName}". ${error.message ?? error}`);
    return null;
  }
  ui.notifications.info(game.i18n.format("TREASURE_CHEST.Create.Created", { name: item.name }));
  item.sheet?.render(true);
  return item;
}

/**
 * @param {string} name
 * @param {string|null} folder
 * @param {object} security
 * @returns {Promise<Item>}
 */
async function createChestItem(name, folder, security) {
  const ownership = foundry.CONST?.DOCUMENT_OWNERSHIP_LEVELS ?? CONST?.DOCUMENT_OWNERSHIP_LEVELS;
  const observer = ownership?.OBSERVER ?? 2;
  return foundry.documents.Item.implementation.create({
    name,
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
}

/** @param {HTMLElement|JQuery|null} htmlOrElement */
function resolveAppElement(htmlOrElement) {
  if (!htmlOrElement) return null;
  if (htmlOrElement instanceof HTMLElement) return htmlOrElement;
  if (htmlOrElement[0] instanceof HTMLElement) return htmlOrElement[0];
  return null;
}

/**
 * The create-item window title is no longer "Create New Item", and the type
 * list can render after app.element exists. Search the element the hook passed.
 * @param {HTMLElement} root
 * @returns {HTMLElement|null}
 */
function findLootRow(root) {
  const input = root.querySelector('input[name="type"][value="loot"]')
    ?? root.querySelector('input[type="radio"][value="loot"]');
  if (input) return input.closest("label, li") ?? input.parentElement;

  const lootName = game.i18n.localize(CONFIG.Item?.typeLabels?.loot ?? "Loot");
  for (const row of root.querySelectorAll("label, li")) {
    const text = row.textContent?.replace(/\s+/g, " ").trim();
    if (text === lootName || text === "Loot") return row;
  }
  return null;
}

/**
 * @param {HTMLElement} row
 * @param {string} label
 */
function setRowLabel(row, label) {
  const caption = [...row.querySelectorAll("span")].find((span) => !span.querySelector("img, input, i"));
  if (caption) {
    caption.textContent = label;
    return;
  }
  for (const node of row.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
      node.textContent = label;
      return;
    }
  }
}

/**
 * @param {Application} app
 * @param {HTMLElement|JQuery} htmlOrElement
 */
function injectChestChoice(app, htmlOrElement) {
  try {
    const hooked = resolveAppElement(htmlOrElement);
    const roots = [hooked, app?.element].filter((element) => element instanceof HTMLElement);
    for (const root of roots) {
      if (root.querySelector(".treasure-chest-choice")) continue;
      const lootRow = findLootRow(root);
      if (!lootRow) continue;

      const chestRow = lootRow.cloneNode(true);
      chestRow.classList.add("treasure-chest-choice");
      const input = chestRow.querySelector('input[name="type"], input[type="radio"]');
      if (!input) continue;
      input.value = "__treasure_chest__";
      input.checked = false;
      input.removeAttribute("id");
      const image = chestRow.querySelector("img");
      if (image) {
        image.src = chestArtwork();
        image.alt = "";
      }
      setRowLabel(chestRow, game.i18n.localize("TREASURE_CHEST.Create.Type"));
      const anchor = root.querySelector(".npc-spellbook-choice") ?? lootRow;
      anchor.after(chestRow);
    }

    const host = app?.element ?? hooked;
    if (!(host instanceof HTMLElement) || host.dataset.treasureChestCreate === "1") return;
    const form = host.querySelector("form") ?? host.querySelector(".treasure-chest-choice")?.closest("form");
    if (!form?.querySelector(".treasure-chest-choice")) return;
    host.dataset.treasureChestCreate = "1";

    const onCreate = async (event) => {
      if (event.type === "click") {
        const button = event.target?.closest?.("button");
        if (!button) return;
        const action = button.dataset.action ?? "";
        const creates = button.type === "submit" || /^(ok|create|confirm|yes)$/i.test(action);
        if (!creates) return;
      }
      const selected = form.querySelector('input[name="type"]:checked')?.value
        ?? form.querySelector('select[name="type"]')?.value;
      if (selected !== "__treasure_chest__") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const scope = app?.element ?? form;
      const folder = scope.querySelector('[name="folder"]')?.value || null;
      const name = scope.querySelector('[name="name"]')?.value ?? "";
      const item = await createChest({ folder, name });
      if (item) app.close();
    };

    form.addEventListener("submit", onCreate, true);
    host.addEventListener("click", onCreate, true);
  } catch (error) {
    console.error("Treasure Chest | Failed to patch the create item dialog", error);
  }
}

/** @param {Application} app @param {HTMLElement|JQuery} html */
function onCreateDialogRender(app, html) {
  injectChestChoice(app, html);
  queueMicrotask(() => injectChestChoice(app, app?.element ?? html));
}

Hooks.on("renderDialog", onCreateDialogRender);
Hooks.on("renderDialogV2", onCreateDialogRender);
Hooks.on("renderApplicationV2", onCreateDialogRender);

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
