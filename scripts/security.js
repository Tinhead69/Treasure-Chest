import {
  MODULE_ID,
  TRAP_PRESET_IDS,
  TRAP_PRESETS,
  getSecurity,
  isChest
} from "./data.js";

const UNDERSTAND_SKILLS = ["inv", "arc"];
const DISARM_SKILLS = ["thieves", "slt", "arc"];
const SAVE_ABILITIES = ["", "str", "dex", "con", "int", "wis", "cha"];
const DAMAGE_TYPES = ["piercing", "slashing", "bludgeoning", "poison", "fire", "acid", "cold", "lightning", "thunder"];

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
 * @param {string[]} ids
 * @param {string} current
 * @param {string} prefix
 * @returns {{ id: string, label: string, selected: boolean }[]}
 */
function options(ids, current, prefix) {
  return ids.map((id) => ({
    id,
    label: game.i18n.localize(id ? `${prefix}.${id}` : `${prefix}.none`),
    selected: id === current
  }));
}

/**
 * @param {object} security
 * @returns {object}
 */
export function securityFormOptions(security) {
  return {
    presets: TRAP_PRESET_IDS.map((id) => ({
      id,
      label: game.i18n.localize(`TREASURE_CHEST.Security.Presets.${id}`),
      selected: security.preset === id
    })),
    understandSkills: options(UNDERSTAND_SKILLS, security.understandSkill, "TREASURE_CHEST.Security.Skills"),
    disarmSkills: options(DISARM_SKILLS, security.disarmSkill, "TREASURE_CHEST.Security.Skills"),
    saves: options(SAVE_ABILITIES, security.saveAbility, "TREASURE_CHEST.Security.Saves"),
    damageTypes: options(DAMAGE_TYPES, security.damageType, "TREASURE_CHEST.Security.Damage")
  };
}

/**
 * @param {HTMLFormElement} form
 * @param {object} previous
 * @returns {object}
 */
export function securityFromForm(form, previous) {
  const field = (name) => form.querySelector(`[name="security.${name}"]`);
  const number = (name, fallback) => {
    const input = field(name);
    const value = Math.floor(Number(input?.value ?? fallback) || 0);
    return value > 0 ? value : 0;
  };
  const preset = field("preset")?.value || previous.preset;
  let next = {
    ...previous,
    locked: Boolean(field("locked")?.checked),
    unlocked: Boolean(field("unlocked")?.checked),
    trapped: Boolean(field("trapped")?.checked),
    detected: Boolean(field("detected")?.checked),
    understood: Boolean(field("understood")?.checked),
    disarmed: Boolean(field("disarmed")?.checked),
    triggered: Boolean(field("triggered")?.checked),
    preset,
    lockDc: number("lockDc", previous.lockDc),
    forceDc: number("forceDc", previous.forceDc),
    detectSkill: "prc",
    detectDc: number("detectDc", previous.detectDc),
    understandSkill: field("understandSkill")?.value === "arc" ? "arc" : "inv",
    understandDc: number("understandDc", previous.understandDc),
    disarmSkill: field("disarmSkill")?.value || previous.disarmSkill,
    disarmDc: number("disarmDc", previous.disarmDc),
    saveAbility: field("saveAbility")?.value ?? previous.saveAbility,
    saveDc: number("saveDc", previous.saveDc),
    damageFormula: String(field("damageFormula")?.value ?? previous.damageFormula).trim(),
    damageType: field("damageType")?.value || previous.damageType,
    rider: String(field("rider")?.value ?? previous.rider)
  };

  if (preset !== previous.preset && TRAP_PRESETS[preset]) {
    next = { ...next, ...TRAP_PRESETS[preset], preset };
  }
  if (next.locked && !previous.locked) next.unlocked = false;
  if (next.trapped && !previous.trapped) {
    next.detected = false;
    next.understood = false;
    next.disarmed = false;
    next.triggered = false;
  }
  if (!next.triggered) next.saveResolved = false;
  return next;
}

/**
 * @param {Item} chest
 * @param {object} changes
 * @returns {Promise<object>}
 */
async function patchSecurity(chest, changes) {
  const next = { ...getSecurity(chest), ...changes };
  await chest.setFlag(MODULE_ID, "security", next);
  return next;
}

/**
 * @param {object} result
 * @returns {number|null}
 */
function totalFromRoll(result) {
  if (!result) return null;
  if (typeof result.total === "number") return result.total;
  const roll = result.rolls?.[0] ?? result.roll;
  if (typeof roll?.total === "number") return roll.total;
  return null;
}

/**
 * @param {Array<() => Promise<unknown>>} attempts
 * @returns {Promise<number|null>}
 */
async function firstRoll(attempts) {
  for (const attempt of attempts) {
    if (!attempt) continue;
    try {
      const result = await attempt();
      if (result == null) return null;
      const total = totalFromRoll(result);
      if (total != null) return total;
    } catch (error) {
      console.warn("Treasure Chest | Check could not be rolled", error);
    }
  }
  ui.notifications.warn(game.i18n.localize("TREASURE_CHEST.Notifications.RollFailed"));
  return null;
}

/**
 * @param {Actor} actor
 * @param {string} skillId
 * @returns {Promise<number|null>}
 */
function rollSkill(actor, skillId) {
  return firstRoll([
    typeof actor.rollSkill === "function" ? () => actor.rollSkill(skillId) : null,
    typeof actor.rollSkill === "function" ? () => actor.rollSkill({ skill: skillId }) : null
  ]);
}

/**
 * @param {Actor} actor
 * @param {string} abilityId
 * @returns {Promise<number|null>}
 */
function rollAbility(actor, abilityId) {
  return firstRoll([
    typeof actor.rollAbilityTest === "function" ? () => actor.rollAbilityTest(abilityId) : null,
    typeof actor.rollAbilityCheck === "function" ? () => actor.rollAbilityCheck({ ability: abilityId }) : null
  ]);
}

/**
 * @param {Actor} actor
 * @param {string} abilityId
 * @returns {Promise<number|null>}
 */
function rollSave(actor, abilityId) {
  return firstRoll([
    typeof actor.rollAbilitySave === "function" ? () => actor.rollAbilitySave(abilityId) : null,
    typeof actor.rollSavingThrow === "function" ? () => actor.rollSavingThrow(abilityId) : null,
    typeof actor.rollSavingThrow === "function" ? () => actor.rollSavingThrow({ ability: abilityId }) : null
  ]);
}

/**
 * @param {Actor} actor
 * @returns {Item|undefined}
 */
function findThievesTools(actor) {
  return actor.items?.find((item) => {
    if (item.type !== "tool") return false;
    const source = item.getFlag?.("core", "sourceId") ?? "";
    const text = `${item.name} ${item.system?.identifier ?? ""} ${source}`.toLowerCase();
    return text.includes("thieves") || text.includes("thief");
  });
}

/**
 * @param {Actor} actor
 * @returns {Promise<number|null>}
 */
function rollThievesTools(actor) {
  const tool = findThievesTools(actor);
  if (!tool) {
    ui.notifications.warn(game.i18n.localize("TREASURE_CHEST.Notifications.NeedTools"));
    return Promise.resolve(null);
  }
  return firstRoll([
    typeof tool.rollToolCheck === "function" ? () => tool.rollToolCheck() : null,
    typeof actor.rollToolCheck === "function" ? () => actor.rollToolCheck(tool.id) : null,
    typeof actor.rollToolCheck === "function" ? () => actor.rollToolCheck({ tool: tool.system?.identifier ?? tool.id }) : null
  ]);
}

/**
 * @param {Actor} actor
 * @param {string} disarmSkill
 * @returns {Promise<number|null>}
 */
function rollDisarm(actor, disarmSkill) {
  if (disarmSkill === "thieves") return rollThievesTools(actor);
  return rollSkill(actor, disarmSkill);
}

/**
 * @param {string} formula
 * @returns {string}
 */
function safeFormula(formula) {
  const text = String(formula ?? "").trim();
  if (!text) return "";
  return /^(\d+d\d+|\d+)([+-]\d+)?$/i.test(text) ? text : "";
}

/**
 * @param {object} security
 * @returns {boolean}
 */
function isArmed(security) {
  return security.trapped && !security.disarmed && !security.triggered;
}

/**
 * @param {object} security
 * @param {string} step
 * @returns {boolean}
 */
function canRequest(security, step) {
  if (step === "examine") return !security.detected;
  if (step === "understand") return isArmed(security) && security.detected && !security.understood;
  if (step === "disarm") return isArmed(security) && security.understood;
  if (step === "unlock" || step === "force") {
    if (!security.locked || security.unlocked) return false;
    if (isArmed(security) && security.detected) return false;
    return true;
  }
  if (step === "save") return security.triggered && Boolean(security.saveAbility) && !security.saveResolved;
  return false;
}

/**
 * @param {string} skillId
 * @returns {string}
 */
function skillName(skillId) {
  return game.i18n.localize(`TREASURE_CHEST.Security.Skills.${skillId}`);
}

/**
 * @param {Item} chest
 * @param {object} security
 * @param {string} step
 * @param {string} actorName
 * @returns {string}
 */
function promptFor(chest, security, step, actorName) {
  const chestName = chest.name;
  if (step === "examine") {
    return game.i18n.format("TREASURE_CHEST.Security.RequestExamine", { chest: chestName, dc: security.detectDc });
  }
  if (step === "understand") {
    const key = security.understandSkill === "arc" ? "RequestUnderstandArc" : "RequestUnderstand";
    return game.i18n.format(`TREASURE_CHEST.Security.${key}`, {
      chest: chestName,
      skill: skillName(security.understandSkill),
      dc: security.understandDc
    });
  }
  if (step === "disarm") {
    return game.i18n.format("TREASURE_CHEST.Security.RequestDisarm", {
      chest: chestName,
      trap: game.i18n.localize(`TREASURE_CHEST.Security.Presets.${security.preset}`),
      skill: skillName(security.disarmSkill),
      dc: security.disarmDc
    });
  }
  if (step === "unlock") {
    return game.i18n.format("TREASURE_CHEST.Security.RequestUnlock", {
      chest: chestName,
      lockDc: security.lockDc,
      forceDc: security.forceDc
    });
  }
  const save = game.i18n.localize(`TREASURE_CHEST.Security.Saves.${security.saveAbility}`);
  return game.i18n.format("TREASURE_CHEST.Security.RequestSave", {
    name: actorName || game.i18n.localize("TREASURE_CHEST.Security.Someone"),
    chest: chestName,
    save,
    dc: security.saveDc
  });
}

/**
 * @param {string} skillId
 * @param {string} step
 * @returns {{ step: string, label: string }}
 */
function rollButton(skillId, step) {
  return {
    step,
    label: game.i18n.format("TREASURE_CHEST.Security.Roll", { skill: skillName(skillId) })
  };
}

/**
 * @param {object} security
 * @param {string} step
 * @returns {{ step: string, label: string }[]}
 */
function buttonsFor(security, step) {
  if (step === "examine") return [rollButton("prc", "examine")];
  if (step === "understand") return [rollButton(security.understandSkill, "understand")];
  if (step === "disarm") return [rollButton(security.disarmSkill, "disarm")];
  if (step === "unlock") {
    return [
      rollButton("thieves", "unlock"),
      {
        step: "force",
        label: game.i18n.format("TREASURE_CHEST.Security.Roll", {
          skill: game.i18n.localize("TREASURE_CHEST.Security.Saves.str")
        })
      }
    ];
  }
  return [{
    step: "save",
    label: game.i18n.format("TREASURE_CHEST.Security.RollSave", {
      save: game.i18n.localize(`TREASURE_CHEST.Security.Saves.${security.saveAbility}`)
    })
  }];
}

/**
 * @param {Item} chest
 * @param {string} step
 * @param {{ quiet?: boolean, actorName?: string }} [options]
 * @returns {Promise<boolean>}
 */
export async function requestCheck(chest, step, { quiet = false, actorName = "" } = {}) {
  const security = getSecurity(chest);
  if (!canRequest(security, step)) {
    if (!quiet) ui.notifications.info(game.i18n.localize("TREASURE_CHEST.Notifications.CheckFinished"));
    return false;
  }
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ alias: chest.name }),
    content: `<div class="treasure-chest-request"><p>${escapeHtml(promptFor(chest, security, step, actorName))}</p></div>`,
    flags: {
      [MODULE_ID]: {
        request: {
          chestUuid: chest.uuid,
          step,
          buttons: buttonsFor(security, step)
        }
      }
    }
  });
  if (!quiet) ui.notifications.info(game.i18n.localize("TREASURE_CHEST.Notifications.Asked"));
  return true;
}

/**
 * @param {Actor|null} actor
 * @param {string} name
 * @returns {object}
 */
function speakerFor(actor, name) {
  if (actor) return ChatMessage.getSpeaker({ actor });
  return { alias: name };
}

/**
 * @param {Actor|null} actor
 * @param {string} name
 * @param {string} key
 * @param {object} data
 * @returns {Promise<void>}
 */
async function narrate(actor, name, key, data) {
  await ChatMessage.create({
    speaker: speakerFor(actor, name),
    content: `<p>${escapeHtml(game.i18n.format(key, { name, ...data }))}</p>`
  });
}

/**
 * @param {Item} chest
 * @param {object} security
 * @param {Actor|null} actor
 * @param {string} name
 * @returns {Promise<void>}
 */
async function announceTrap(chest, security, actor, name) {
  const trapName = game.i18n.localize(`TREASURE_CHEST.Security.Presets.${security.preset}`);
  const parts = [`<p><strong>${escapeHtml(chest.name)}</strong> — ${escapeHtml(trapName)}.</p>`];
  if (security.rider) parts.push(`<p>${escapeHtml(security.rider)}</p>`);
  await ChatMessage.create({ speaker: speakerFor(actor, name), content: parts.join("") });
}

/**
 * @param {Item} chest
 * @param {object} security
 * @param {Actor|null} actor
 * @param {string} name
 * @returns {Promise<void>}
 */
async function finishTrap(chest, security, actor, name) {
  const formula = safeFormula(security.damageFormula);
  if (!formula) return;
  try {
    const RollCls = foundry.dice?.Roll ?? globalThis.Roll;
    const roll = new RollCls(formula);
    await roll.evaluate();
    const type = game.i18n.localize(`TREASURE_CHEST.Security.Damage.${security.damageType || "piercing"}`);
    await roll.toMessage({
      speaker: speakerFor(actor, name),
      flavor: game.i18n.format("TREASURE_CHEST.Security.DamageFlavor", { type })
    });
  } catch (error) {
    console.error("Treasure Chest | Trap damage could not be rolled", error);
  }
}

/**
 * @param {Item} chest
 * @param {object} security
 * @param {Actor|null} actor
 * @param {string} name
 * @returns {Promise<void>}
 */
async function springTrap(chest, security, actor, name) {
  await announceTrap(chest, security, actor, name);
  if (security.saveAbility) {
    await requestCheck(chest, "save", { quiet: true, actorName: name });
    return;
  }
  await patchSecurity(chest, { saveResolved: true });
  await finishTrap(chest, security, actor, name);
}

/**
 * @param {Item} chest
 * @param {Actor|null} actor
 * @param {string} name
 * @param {number} total
 * @returns {Promise<void>}
 */
async function commitExamine(chest, actor, name, total) {
  const security = getSecurity(chest);
  if (!canRequest(security, "examine")) return;
  if (isArmed(security) && total >= security.detectDc) {
    await patchSecurity(chest, { detected: true });
    await narrate(actor, name, "TREASURE_CHEST.Security.Noticed", { chest: chest.name });
    await requestCheck(chest, "understand", { quiet: true });
    return;
  }
  await narrate(actor, name, "TREASURE_CHEST.Security.Nothing", { chest: chest.name });
}

/**
 * @param {Item} chest
 * @param {Actor|null} actor
 * @param {string} name
 * @param {number} total
 * @returns {Promise<void>}
 */
async function commitUnderstand(chest, actor, name, total) {
  const security = getSecurity(chest);
  if (!canRequest(security, "understand")) return;
  if (total >= security.understandDc) {
    await patchSecurity(chest, { understood: true });
    await narrate(actor, name, "TREASURE_CHEST.Security.UnderstoodResult", {
      chest: chest.name,
      trap: game.i18n.localize(`TREASURE_CHEST.Security.Presets.${security.preset}`)
    });
    await requestCheck(chest, "disarm", { quiet: true });
    return;
  }
  await narrate(actor, name, "TREASURE_CHEST.Security.UnderstandFailed", { chest: chest.name });
}

/**
 * @param {Item} chest
 * @param {Actor|null} actor
 * @param {string} name
 * @param {number} total
 * @returns {Promise<void>}
 */
async function commitDisarm(chest, actor, name, total) {
  const security = getSecurity(chest);
  if (!canRequest(security, "disarm")) return;
  if (total >= security.disarmDc) {
    await patchSecurity(chest, { disarmed: true, detected: true, understood: true });
    await narrate(actor, name, "TREASURE_CHEST.Security.DisarmedResult", { chest: chest.name, total });
    if (security.locked && !security.unlocked) await requestCheck(chest, "unlock", { quiet: true });
    return;
  }
  await patchSecurity(chest, { triggered: true, detected: true, saveResolved: false });
  await narrate(actor, name, "TREASURE_CHEST.Security.DisarmFailed", { chest: chest.name, total });
  await springTrap(chest, security, actor, name);
}

/**
 * @param {Item} chest
 * @param {Actor|null} actor
 * @param {string} name
 * @param {number} total
 * @param {boolean} force
 * @returns {Promise<void>}
 */
async function commitUnlock(chest, actor, name, total, force) {
  const security = getSecurity(chest);
  if (!canRequest(security, force ? "force" : "unlock")) return;
  if (isArmed(security)) {
    await patchSecurity(chest, { triggered: true, detected: true, saveResolved: false });
    await springTrap(chest, security, actor, name);
  }
  const dc = force ? security.forceDc : security.lockDc;
  if (total >= dc) {
    await patchSecurity(chest, { unlocked: true });
    const key = force ? "TREASURE_CHEST.Security.Forced" : "TREASURE_CHEST.Security.UnlockedResult";
    await narrate(actor, name, key, { chest: chest.name, total });
    return;
  }
  const key = force ? "TREASURE_CHEST.Security.ForceFailed" : "TREASURE_CHEST.Security.UnlockFailed";
  await narrate(actor, name, key, { chest: chest.name, total });
}

/**
 * @param {Item} chest
 * @param {Actor|null} actor
 * @param {string} name
 * @param {number} total
 * @returns {Promise<void>}
 */
async function commitSave(chest, actor, name, total) {
  const security = getSecurity(chest);
  if (!canRequest(security, "save")) return;
  const saved = total >= security.saveDc;
  await patchSecurity(chest, { saveResolved: true });
  const key = saved ? "TREASURE_CHEST.Security.Saved" : "TREASURE_CHEST.Security.FailedSave";
  await narrate(actor, name, key, { total, dc: security.saveDc });
  await finishTrap(chest, security, actor, name);
}

/**
 * @param {Actor} actor
 * @param {object} security
 * @param {string} step
 * @returns {Promise<number|null>}
 */
function rollForStep(actor, security, step) {
  if (step === "examine") return rollSkill(actor, "prc");
  if (step === "understand") return rollSkill(actor, security.understandSkill);
  if (step === "disarm") return rollDisarm(actor, security.disarmSkill);
  if (step === "unlock") return rollThievesTools(actor);
  if (step === "force") return rollAbility(actor, "str");
  if (step === "save") return rollSave(actor, security.saveAbility);
  return Promise.resolve(null);
}

/** @returns {Actor|null} */
function actingActor() {
  const tokens = canvas?.tokens?.controlled ?? [];
  const owned = [];
  const seen = new Set();
  for (const token of tokens) {
    const actor = token.actor;
    if (!actor?.isOwner || seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);
    owned.push(actor);
  }
  if (owned.length === 1) return owned[0];
  if (owned.length > 1) {
    ui.notifications.warn(game.i18n.localize("TREASURE_CHEST.Notifications.OneCharacter"));
    return null;
  }
  if (game.user.character) return game.user.character;
  ui.notifications.warn(game.i18n.localize("TREASURE_CHEST.Notifications.SelectCharacter"));
  return null;
}

const resolvedChecks = new Set();

/**
 * @param {object} payload
 * @returns {Promise<void>}
 */
async function resolveCheck(payload) {
  if (!payload?.id || resolvedChecks.has(payload.id)) return;
  resolvedChecks.add(payload.id);
  if (!game.user.isGM) return;
  const total = Number(payload.total);
  if (!Number.isFinite(total)) return;
  const chest = await fromUuid(payload.chestUuid);
  if (!chest || !isChest(chest)) return;
  const actor = payload.actorUuid ? await fromUuid(payload.actorUuid) : null;
  const name = actor?.name || payload.actorName || game.i18n.localize("TREASURE_CHEST.Security.Someone");
  if (payload.step === "examine") return commitExamine(chest, actor, name, total);
  if (payload.step === "understand") return commitUnderstand(chest, actor, name, total);
  if (payload.step === "disarm") return commitDisarm(chest, actor, name, total);
  if (payload.step === "unlock") return commitUnlock(chest, actor, name, total, false);
  if (payload.step === "force") return commitUnlock(chest, actor, name, total, true);
  if (payload.step === "save") return commitSave(chest, actor, name, total);
}

/**
 * @param {object} message
 * @returns {boolean}
 */
export function handleSecuritySocket(message) {
  if (message?.action !== "resolveCheck") return false;
  if (!game.user.isGM) return true;
  if (game.users.activeGM && !game.users.activeGM.isSelf) return true;
  resolveCheck(message).catch((error) => console.error("Treasure Chest | Could not record the check", error));
  return true;
}

const pendingRolls = new Set();

/**
 * @param {ChatMessage} message
 * @param {string} step
 * @returns {Promise<void>}
 */
async function rollFromRequest(message, step) {
  const request = message.getFlag(MODULE_ID, "request");
  if (!request?.chestUuid) return;
  const key = `${message.id}:${step}`;
  if (pendingRolls.has(key)) return;
  pendingRolls.add(key);
  try {
    const chest = await fromUuid(request.chestUuid);
    if (!chest || !isChest(chest)) {
      ui.notifications.warn(game.i18n.localize("TREASURE_CHEST.Notifications.MissingChest"));
      return;
    }
    const security = getSecurity(chest);
    if (!canRequest(security, step)) {
      const needsDisarm = (step === "unlock" || step === "force") && isArmed(security) && security.detected;
      const key = needsDisarm ? "TREASURE_CHEST.Notifications.DisarmFirst" : "TREASURE_CHEST.Notifications.CheckFinished";
      ui.notifications.warn(game.i18n.localize(key));
      refreshRequestButtons(chest.uuid);
      return;
    }
    const actor = actingActor();
    if (!actor) return;
    const total = await rollForStep(actor, security, step);
    if (total == null) return;
    const payload = {
      action: "resolveCheck",
      id: foundry.utils.randomID?.() ?? `${Date.now()}-${actor.id}`,
      chestUuid: chest.uuid,
      step,
      total,
      actorUuid: actor.uuid,
      actorName: actor.name
    };
    if (game.user.isGM) {
      await resolveCheck(payload);
      return;
    }
    if (!game.users.activeGM) {
      ui.notifications.warn(game.i18n.localize("TREASURE_CHEST.Notifications.NoGamemaster"));
      return;
    }
    game.socket.emit(`module.${MODULE_ID}`, payload);
  } finally {
    pendingRolls.delete(key);
  }
}

/**
 * @param {string} chestUuid
 * @param {HTMLElement} root
 */
function applyButtonState(chestUuid, root) {
  const fromSync = globalThis.fromUuidSync ?? foundry.utils.fromUuidSync;
  const chest = fromSync?.(chestUuid);
  const security = chest && isChest(chest) ? getSecurity(chest) : null;
  root.querySelectorAll(".treasure-chest-roll").forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    button.disabled = security ? !canRequest(security, button.dataset.step ?? "") : false;
  });
}

/** @param {string} [chestUuid] */
function refreshRequestButtons(chestUuid) {
  document.querySelectorAll("[data-message-id]").forEach((messageEl) => {
    if (!(messageEl instanceof HTMLElement)) return;
    const message = game.messages.get(messageEl.dataset.messageId);
    const request = message?.getFlag(MODULE_ID, "request");
    if (!request?.chestUuid || (chestUuid && request.chestUuid !== chestUuid)) return;
    applyButtonState(request.chestUuid, messageEl);
  });
}

/**
 * @param {ChatMessage} message
 * @param {HTMLElement|JQuery} html
 */
function onRenderChatMessage(message, html) {
  const request = message.getFlag?.(MODULE_ID, "request");
  if (!request?.buttons?.length) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!(root instanceof HTMLElement)) return;
  const content = root.querySelector(".message-content") ?? root;
  if (content.querySelector(".treasure-chest-actions")) {
    applyButtonState(request.chestUuid, root);
    return;
  }
  const actions = document.createElement("div");
  actions.className = "treasure-chest-actions";
  for (const button of request.buttons) {
    if (!button?.step || !button.label) continue;
    const element = document.createElement("button");
    element.type = "button";
    element.className = "treasure-chest-roll";
    element.dataset.step = button.step;
    element.textContent = button.label;
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      rollFromRequest(message, button.step);
    });
    actions.append(element);
  }
  const host = content.querySelector(".treasure-chest-request") ?? content;
  host.append(actions);
  applyButtonState(request.chestUuid, root);
}

let requestsRegistered = false;

export function registerCheckRequests() {
  if (requestsRegistered) return;
  requestsRegistered = true;
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
  Hooks.on("renderChatMessage", onRenderChatMessage);
  Hooks.on("updateItem", (item) => {
    if (isChest(item)) refreshRequestButtons(item.uuid);
  });
}
