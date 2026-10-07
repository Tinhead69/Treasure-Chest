export const MODULE_ID = "treasure-chest";

const BROKEN_CHEST_ICONS = new Set([
  "",
  "icons/svg/item-bag.svg",
  "icons/svg/mystery-man.svg",
  "icons/containers/chest/chest-reinforced-steel-brown.webp",
  "modules/treasure-chest/assets/chest.svg"
]);

/**
 * The same artwork dnd5e uses for a loot item.
 * @returns {string}
 */
export function chestArtwork() {
  return CONFIG.DND5E?.defaultArtwork?.loot || "systems/dnd5e/icons/svg/items/loot.svg";
}

/**
 * Portrait to show for a chest. Replaces paths that do not resolve.
 * @param {Item|null|undefined} item
 * @returns {string}
 */
export function chestPortrait(item) {
  const img = String(item?.img ?? "");
  return BROKEN_CHEST_ICONS.has(img) ? chestArtwork() : img;
}

export const DENOMINATIONS = ["pp", "gp", "ep", "sp", "cp"];

export const GEAR_TYPES = new Set([
  "weapon",
  "equipment",
  "consumable",
  "tool",
  "loot",
  "container",
  "backpack"
]);

export const SECTION_ORDER = ["equipment", "consumable", "magic"];

const MAGIC_RARITIES = new Set(["uncommon", "rare", "veryrare", "legendary", "artifact"]);

export const EMPTY_CURRENCY = Object.freeze({ pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 });

/**
 * @param {number|string|null|undefined} value
 * @returns {number}
 */
export function asCoins(value) {
  const number = Math.floor(Number(value) || 0);
  return number > 0 ? number : 0;
}

/**
 * @param {Item} item
 * @returns {boolean}
 */
export function isChest(item) {
  return item?.getFlag?.(MODULE_ID, "isChest") === true;
}

/**
 * @param {object} system
 * @returns {boolean}
 */
export function isMagicSystem(system) {
  const rarity = String(system?.rarity ?? "").toLowerCase().replace(/\s+/g, "");
  if (MAGIC_RARITIES.has(rarity)) return true;

  const properties = system?.properties;
  if (!properties) return false;
  if (Array.isArray(properties)) return properties.includes("mgc");
  if (typeof properties.has === "function") return properties.has("mgc");
  return Boolean(properties.mgc);
}

/**
 * Equipment, consumable, or magic. Magic wins over the other two.
 * @param {{ data?: { type?: string, system?: object } }} entry
 * @returns {"equipment"|"consumable"|"magic"}
 */
export function itemCategory(entry) {
  const data = entry?.data ?? {};
  if (isMagicSystem(data.system)) return "magic";
  if (data.type === "consumable") return "consumable";
  return "equipment";
}

/**
 * @param {Array<object>} contents
 * @returns {Record<"equipment"|"consumable"|"magic", object[]>}
 */
export function groupContents(contents) {
  const buckets = { equipment: [], consumable: [], magic: [] };
  for (const entry of contents ?? []) {
    const category = itemCategory(entry);
    buckets[category].push(entry);
  }
  for (const id of SECTION_ORDER) {
    buckets[id].sort((a, b) => a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
  }
  return buckets;
}

/**
 * @param {Item} item
 * @returns {{ pp: number, gp: number, ep: number, sp: number, cp: number }}
 */
export function getCurrency(item) {
  const raw = item?.getFlag?.(MODULE_ID, "currency") ?? {};
  return {
    pp: asCoins(raw.pp),
    gp: asCoins(raw.gp),
    ep: asCoins(raw.ep),
    sp: asCoins(raw.sp),
    cp: asCoins(raw.cp)
  };
}

/**
 * @param {Item} item
 * @param {object} currency
 * @returns {Promise<void>}
 */
export async function setCurrency(item, currency) {
  const next = {};
  for (const key of DENOMINATIONS) next[key] = asCoins(currency?.[key]);
  await item.setFlag(MODULE_ID, "currency", next);
}

/**
 * @param {Item} item
 * @returns {object[]}
 */
export function getContents(item) {
  const contents = item?.getFlag?.(MODULE_ID, "contents");
  return Array.isArray(contents) ? contents : [];
}

/**
 * @param {Item} item
 * @param {object[]} contents
 * @returns {Promise<void>}
 */
export async function setContents(item, contents) {
  await item.setFlag(MODULE_ID, "contents", contents);
}

/**
 * @param {Item} item
 * @returns {boolean}
 */
export function isChestEmpty(item) {
  const currency = getCurrency(item);
  const noCoins = DENOMINATIONS.every((key) => currency[key] === 0);
  return noCoins && getContents(item).length === 0;
}

/**
 * @param {object} currency
 * @returns {boolean}
 */
export function hasCoins(currency) {
  return DENOMINATIONS.some((key) => asCoins(currency?.[key]) > 0);
}

export const TRAP_PRESET_IDS = ["poison-needle", "poison-dart", "glyph", "acid", "alarm", "blade", "custom"];

/** @type {Record<string, object>} */
export const TRAP_PRESETS = {
  "poison-needle": {
    detectSkill: "prc",
    detectDc: 15,
    understandSkill: "inv",
    understandDc: 15,
    disarmSkill: "thieves",
    disarmDc: 15,
    saveAbility: "con",
    saveDc: 15,
    damageFormula: "1",
    damageType: "piercing",
    rider: "On a failed save, the creature is poisoned for 1 hour."
  },
  "poison-dart": {
    detectSkill: "prc",
    detectDc: 15,
    understandSkill: "inv",
    understandDc: 15,
    disarmSkill: "thieves",
    disarmDc: 15,
    saveAbility: "dex",
    saveDc: 15,
    damageFormula: "2d4",
    damageType: "piercing",
    rider: "On a failed save, the creature is poisoned for 1 hour."
  },
  glyph: {
    detectSkill: "prc",
    detectDc: 15,
    understandSkill: "arc",
    understandDc: 15,
    disarmSkill: "arc",
    disarmDc: 15,
    saveAbility: "dex",
    saveDc: 15,
    damageFormula: "4d6",
    damageType: "fire",
    rider: ""
  },
  acid: {
    detectSkill: "prc",
    detectDc: 13,
    understandSkill: "inv",
    understandDc: 13,
    disarmSkill: "thieves",
    disarmDc: 13,
    saveAbility: "dex",
    saveDc: 13,
    damageFormula: "2d6",
    damageType: "acid",
    rider: ""
  },
  alarm: {
    detectSkill: "prc",
    detectDc: 12,
    understandSkill: "arc",
    understandDc: 12,
    disarmSkill: "arc",
    disarmDc: 12,
    saveAbility: "",
    saveDc: 0,
    damageFormula: "",
    damageType: "piercing",
    rider: "An audible alarm sounds for 1 minute."
  },
  blade: {
    detectSkill: "prc",
    detectDc: 15,
    understandSkill: "inv",
    understandDc: 15,
    disarmSkill: "thieves",
    disarmDc: 15,
    saveAbility: "dex",
    saveDc: 15,
    damageFormula: "2d10",
    damageType: "slashing",
    rider: ""
  }
};

/**
 * @returns {object}
 */
export function defaultSecurity() {
  return {
    locked: false,
    lockDc: 15,
    forceDc: 20,
    unlocked: false,
    trapped: false,
    preset: "poison-needle",
    detected: false,
    understood: false,
    disarmed: false,
    triggered: false,
    saveResolved: false,
    ...TRAP_PRESETS["poison-needle"]
  };
}

/**
 * @param {number|string|null|undefined} value
 * @returns {number}
 */
function asDc(value) {
  const number = Math.floor(Number(value) || 0);
  return number > 0 ? number : 0;
}

/**
 * @param {Item} item
 * @returns {object}
 */
export function getSecurity(item) {
  const defaults = defaultSecurity();
  const raw = item?.getFlag?.(MODULE_ID, "security") ?? {};
  const security = { ...defaults, ...raw };
  security.locked = Boolean(security.locked);
  security.unlocked = Boolean(security.unlocked);
  security.trapped = Boolean(security.trapped);
  security.detected = Boolean(security.detected);
  security.understood = Boolean(security.understood);
  security.disarmed = Boolean(security.disarmed);
  security.triggered = Boolean(security.triggered);
  security.saveResolved = Boolean(security.saveResolved);
  security.lockDc = asDc(security.lockDc);
  security.forceDc = asDc(security.forceDc);
  security.detectDc = asDc(security.detectDc);
  security.detectSkill = "prc";
  security.understandSkill = security.understandSkill === "arc" ? "arc" : "inv";
  security.understandDc = asDc(security.understandDc || security.detectDc);
  security.disarmDc = asDc(security.disarmDc);
  security.saveDc = asDc(security.saveDc);
  security.preset = TRAP_PRESET_IDS.includes(security.preset) ? security.preset : "custom";
  security.damageFormula = String(security.damageFormula ?? "").trim();
  security.rider = String(security.rider ?? "");
  return security;
}

/**
 * Locked, or trapped and still armed.
 * @param {Item} item
 * @returns {"locked"|"armed"|null}
 */
export function sealReason(item) {
  const security = getSecurity(item);
  if (security.locked && !security.unlocked) return "locked";
  if (security.trapped && !security.disarmed && !security.triggered) return "armed";
  return null;
}
