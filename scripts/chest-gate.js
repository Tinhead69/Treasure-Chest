import { chestPortrait, getSecurity, isChest, sealReason } from "./data.js";
import { requestCheck } from "./security.js";

const { ApplicationV2 } = foundry.applications.api;

/**
 * Translate a key, falling back to plain English if the key does not exist.
 * @param {string} key
 * @param {string} fallback
 * @param {object} [data]
 * @returns {string}
 */
function localizeOr(key, fallback, data) {
  const text = data ? game.i18n.format(key, data) : game.i18n.localize(key);
  if (text !== key) return text;
  return data ? fallback.replace(/\{(\w+)\}/g, (_, name) => String(data[name] ?? "")) : fallback;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

/**
 * @param {Item} chest
 * @returns {string}
 */
function gateId(chest) {
  return `treasure-chest-gate-${chest.id}`;
}

/**
 * Players cannot open a sealed chest. They get the gate instead.
 * The GM always gets the sheet.
 * @param {Item} chest
 * @returns {boolean}
 */
export function shouldGate(chest) {
  return !game.user.isGM && isChest(chest) && Boolean(sealReason(chest));
}

/**
 * What the character can currently try. This follows the same rules as the
 * buttons on the chest sheet.
 * @param {object} security
 * @returns {{ step: string, icon: string, label: string, disabled?: boolean }[]}
 */
function availableSteps(security) {
  const armed = security.trapped && !security.disarmed && !security.triggered;
  const lockedShut = security.locked && !security.unlocked;
  const steps = [];

  if (armed && !security.detected) {
    steps.push({
      step: "examine",
      icon: "fa-magnifying-glass",
      label: game.i18n.localize("TREASURE_CHEST.Security.Examine")
    });
  }
  if (armed && security.detected && !security.understood) {
    steps.push({
      step: "understand",
      icon: "fa-lightbulb",
      label: game.i18n.localize(security.understandSkill === "arc"
        ? "TREASURE_CHEST.Security.UnderstandArcana"
        : "TREASURE_CHEST.Security.UnderstandInvestigation")
    });
  }
  if (armed && security.understood) {
    steps.push({
      step: "disarm",
      icon: "fa-screwdriver-wrench",
      label: game.i18n.localize("TREASURE_CHEST.Security.Disarm")
    });
  }
  if (lockedShut) {
    // A spotted trap has to be dealt with before anyone touches the lock.
    const blocked = armed && security.detected;
    steps.push({
      step: "unlock",
      icon: "fa-key",
      label: game.i18n.localize("TREASURE_CHEST.Security.Unlock"),
      disabled: blocked
    });
    steps.push({
      step: "force",
      icon: "fa-hand-fist",
      label: game.i18n.localize("TREASURE_CHEST.Security.Force"),
      disabled: blocked
    });
  }
  return steps;
}

/**
 * Only says what the character has found out. An undiscovered trap is not mentioned.
 * @param {object} security
 * @returns {string[]}
 */
function statusLines(security) {
  const lines = [];
  if (security.locked && !security.unlocked) {
    lines.push(game.i18n.localize("TREASURE_CHEST.Security.StatusLocked"));
  }
  if (security.trapped) {
    if (security.disarmed) {
      lines.push(game.i18n.localize("TREASURE_CHEST.Security.StatusDisarmed"));
    } else if (security.triggered) {
      lines.push(game.i18n.localize("TREASURE_CHEST.Security.StatusTriggered"));
    } else if (security.understood) {
      const trap = game.i18n.localize(`TREASURE_CHEST.Security.Presets.${security.preset}`);
      lines.push(`${game.i18n.localize("TREASURE_CHEST.Security.StatusTrapped")} ${trap}`);
    } else if (security.detected) {
      lines.push(game.i18n.localize("TREASURE_CHEST.Security.StatusUnclear"));
    }
  }
  return lines;
}

/**
 * @param {Item} chest
 * @returns {string}
 */
function gateHtml(chest) {
  const security = getSecurity(chest);
  const steps = availableSteps(security);
  const status = statusLines(security);
  const prompt = localizeOr(
    "TREASURE_CHEST.Gate.Prompt",
    "{chest} can't be opened yet. What would you like to try?",
    { chest: chest.name }
  );
  const blockedHint = game.i18n.localize("TREASURE_CHEST.Notifications.DisarmFirst");

  const buttons = steps.map((entry) => `
    <button type="button" data-action="check" data-step="${entry.step}"
      ${entry.disabled ? `disabled title="${escapeHtml(blockedHint)}"` : ""}>
      <i class="fa-solid ${entry.icon}"></i> ${escapeHtml(entry.label)}
    </button>`).join("");

  return `
    <div class="gate">
      <header class="gate-header">
        <img src="${escapeHtml(chestPortrait(chest))}" alt="">
        <p>${escapeHtml(prompt)}</p>
      </header>
      ${status.length ? `<div class="gate-status">${status.map((line) => `<p><i class="fa-solid fa-lock"></i> ${escapeHtml(line)}</p>`).join("")}</div>` : ""}
      ${buttons ? `<div class="gate-actions">${buttons}</div>
      <p class="gate-hint">${escapeHtml(game.i18n.localize("TREASURE_CHEST.Security.RequestHint"))}</p>` : ""}
    </div>`;
}

/** The pop-up a player sees instead of the sheet while the chest is sealed. */
export class ChestGate extends ApplicationV2 {
  /** @param {Item} chest */
  constructor(chest) {
    super({ id: gateId(chest) });
    this.chest = chest;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["treasure-chest", "treasure-chest-gate"],
    position: { width: 380 },
    window: { icon: "fa-solid fa-lock", resizable: false },
    actions: {
      check: ChestGate.#onCheck
    }
  };

  /** @override */
  get title() {
    return this.chest.name;
  }

  /** @override */
  async _renderHTML() {
    return gateHtml(this.chest);
  }

  /** @override */
  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static async #onCheck(event, target) {
    const gate = /** @type {ChestGate} */ (this);
    const step = target.dataset.step;
    if (!step) return;
    await requestCheck(gate.chest, step);
  }
}

/**
 * Show the gate for a chest, or bring it forward if it is already open.
 * @param {Item} chest
 * @returns {Promise<ChestGate>}
 */
export async function openChestGate(chest) {
  const open = foundry.applications.instances.get(gateId(chest));
  if (open) {
    await open.render({ force: true });
    open.bringToFront?.();
    return open;
  }
  return new ChestGate(chest).render({ force: true });
}

/**
 * The normal way to open a chest: players get the gate while it is sealed,
 * everyone else gets the sheet.
 * @param {Item} chest
 * @returns {Promise<unknown>}
 */
export async function openChest(chest) {
  if (shouldGate(chest)) return openChestGate(chest);
  return chest.sheet?.render(true);
}

/** Keep any open gate in step with the chest, and open the sheet once it is free. */
export function registerChestGate() {
  Hooks.on("updateItem", (item) => {
    if (!isChest(item)) return;
    const gate = foundry.applications.instances.get(gateId(item));
    if (!gate) return;
    if (sealReason(item)) {
      gate.render();
      return;
    }
    gate.close().then(() => item.sheet?.render(true));
  });

  Hooks.on("deleteItem", (item) => {
    foundry.applications.instances.get(gateId(item))?.close();
  });
}
