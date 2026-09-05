import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import {
  characterSource,
  discoverCharacterCatalog,
  type CharacterCatalogEntry,
  type CharacterLocations,
} from "./character-catalog.ts";
import {
  CharacterEditError,
  createCharacterTemplate,
  createPersonalCharacter,
  createPersonalOverride,
  isPersonalCharacter,
  readCharacterCard,
  updatePersonalCharacter,
} from "./character-editor.ts";
import { isCharacterId, type Character } from "./character-loader.ts";
import type { AvatarMode, IncarnateSessionState } from "./session-state.ts";

export interface IncarnateMenuDependencies {
  locations: CharacterLocations;
  state: IncarnateSessionState;
  onStateChange?: (ctx: ExtensionCommandContext) => Promise<void> | void;
}

type MainAction = "character" | "mood" | "avatar" | "create" | "edit" | "status" | "off" | "close";

const SOURCE_LABELS = { personal: "personal", "built-in": "built-in" } as const;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function statusText(state: IncarnateSessionState, locations: CharacterLocations): string {
  const active = state.activeCharacter;
  if (!active) return `Character mode: off\nAvatar: ${state.avatarMode}`;
  return `Active character: ${active.name} (${active.id})\nSource: ${characterSource(active, locations)}\nMood: ${state.currentMood ?? "none"}\nAvatar: ${state.avatarMode}\nForms: ${active.forms.filter((form) => form.status === "available").length}/${active.forms.length} available\nCard: ${active.cardPath}`;
}

async function chooseCharacter(
  ctx: ExtensionCommandContext,
  locations: CharacterLocations,
  title: string,
): Promise<CharacterCatalogEntry | undefined> {
  const { entries, issues } = await discoverCharacterCatalog(locations);
  if (entries.length === 0) {
    ctx.ui.notify("No valid characters found", "warning");
    if (issues.length > 0) ctx.ui.notify(issues[0]!.message, "error");
    return undefined;
  }
  const labels = entries.map(({ character, source }) => `${character.name} (${character.id}) · ${SOURCE_LABELS[source]}`);
  const selected = await ctx.ui.select(title, [...labels, "← Back"]);
  if (!selected || selected === "← Back") return undefined;
  return entries[labels.indexOf(selected)];
}

async function switchCharacter(ctx: ExtensionCommandContext, dependencies: IncarnateMenuDependencies): Promise<void> {
  const selected = await chooseCharacter(ctx, dependencies.locations, "Choose a character");
  if (!selected) return;
  dependencies.state.activate(selected.character);
  await dependencies.onStateChange?.(ctx);
  ctx.ui.notify(`Character enabled: ${selected.character.name} (${selected.character.id})`, "info");
}

async function chooseMood(ctx: ExtensionCommandContext, dependencies: IncarnateMenuDependencies): Promise<void> {
  const active = dependencies.state.activeCharacter;
  if (!active) {
    ctx.ui.notify("Enable a character before selecting a mood", "warning");
    return;
  }
  const presets = [...active.mood.presets.values()];
  if (presets.length === 0) {
    ctx.ui.notify(`${active.name} has no mood presets`, "info");
    return;
  }
  const labels = presets.map((preset) => `${preset.id}${preset.id === dependencies.state.currentMood ? " · active" : ""}`);
  const selected = await ctx.ui.select(`Mood · ${active.name}`, [...labels, "← Back"]);
  if (!selected || selected === "← Back") return;
  const preset = presets[labels.indexOf(selected)];
  if (!preset) return;
  dependencies.state.setMood(preset.id);
  await dependencies.onStateChange?.(ctx);
  ctx.ui.notify(`Mood changed: ${preset.id}`, "info");
}

async function chooseAvatarMode(ctx: ExtensionCommandContext, dependencies: IncarnateMenuDependencies): Promise<void> {
  const options: Array<{ mode: AvatarMode; label: string }> = [
    { mode: "auto", label: "Auto · responsive full/compact" },
    { mode: "full", label: "Full · always show avatar" },
    { mode: "compact", label: "Compact · status only" },
    { mode: "off", label: "Off · hide widget" },
  ];
  const labels = options.map(({ mode, label }) => `${label}${mode === dependencies.state.avatarMode ? " · active" : ""}`);
  const selected = await ctx.ui.select("Avatar mode", [...labels, "← Back"]);
  if (!selected || selected === "← Back") return;
  const option = options[labels.indexOf(selected)];
  if (!option) return;
  dependencies.state.setAvatarMode(option.mode);
  await dependencies.onStateChange?.(ctx);
  ctx.ui.notify(`Avatar: ${option.mode}`, "info");
}

async function promptForCharacterId(
  ctx: ExtensionCommandContext,
  locations: CharacterLocations,
): Promise<string | undefined> {
  const value = await ctx.ui.input("New character id", "lowercase letters, numbers, and hyphens");
  if (value === undefined) return undefined;
  const id = value.trim();
  if (!isCharacterId(id)) {
    ctx.ui.notify("Character id must use lowercase letters, numbers, and interior hyphens", "error");
    return undefined;
  }
  const { entries } = await discoverCharacterCatalog(locations);
  if (entries.some((entry) => entry.character.id === id)) {
    ctx.ui.notify(`Character already exists: ${id}. Choose Edit character card instead.`, "error");
    return undefined;
  }
  return id;
}

async function createCharacter(ctx: ExtensionCommandContext, dependencies: IncarnateMenuDependencies): Promise<void> {
  const personalRoot = dependencies.locations.personalRoot;
  if (!personalRoot) {
    ctx.ui.notify("Personal character storage is not configured", "error");
    return;
  }
  const id = await promptForCharacterId(ctx, dependencies.locations);
  if (!id) return;
  const nameInput = await ctx.ui.input("Character name", "display name");
  if (nameInput === undefined) return;
  const name = nameInput.trim().replace(/[\r\n]+/g, " ");
  if (!name) {
    ctx.ui.notify("Character name must not be empty", "error");
    return;
  }
  const markdown = await ctx.ui.editor(`Create ${name} (${id})`, createCharacterTemplate(name));
  if (markdown === undefined) return;
  try {
    const character = await createPersonalCharacter(personalRoot, id, markdown);
    ctx.ui.notify(`Character created: ${character.name}\n${character.cardPath}`, "info");
    if (await ctx.ui.confirm("Enable character?", `Use ${character.name} in this session now?`)) {
      dependencies.state.activate(character);
      await dependencies.onStateChange?.(ctx);
    }
  } catch (error) {
    ctx.ui.notify(errorMessage(error, "Failed to create character"), "error");
  }
}

async function saveEditedCharacter(
  dependencies: IncarnateMenuDependencies,
  selected: CharacterCatalogEntry,
  markdown: string,
): Promise<Character> {
  const personalRoot = dependencies.locations.personalRoot;
  if (!personalRoot) throw new CharacterEditError("Personal character storage is not configured");
  if (isPersonalCharacter(selected.character, personalRoot)) {
    return await updatePersonalCharacter(personalRoot, selected.character.id, markdown);
  }
  return await createPersonalOverride(personalRoot, selected.character, markdown);
}

async function editCharacter(ctx: ExtensionCommandContext, dependencies: IncarnateMenuDependencies): Promise<void> {
  const selected = await chooseCharacter(ctx, dependencies.locations, "Edit character card");
  if (!selected) return;
  if (selected.source === "built-in") {
    const confirmed = await ctx.ui.confirm(
      "Create personal copy?",
      `${selected.character.name} is built in. Editing creates a personal override that survives package updates.`,
    );
    if (!confirmed) return;
  }
  try {
    const current = await readCharacterCard(selected.character);
    const markdown = await ctx.ui.editor(`Edit ${selected.character.name} (${selected.character.id})`, current);
    if (markdown === undefined || markdown === current) return;
    const character = await saveEditedCharacter(dependencies, selected, markdown);
    if (dependencies.state.activeCharacter?.id === character.id) {
      dependencies.state.activate(character);
      await dependencies.onStateChange?.(ctx);
    }
    ctx.ui.notify(`Character card saved: ${character.name}\n${character.cardPath}`, "info");
  } catch (error) {
    ctx.ui.notify(errorMessage(error, "Failed to edit character"), "error");
  }
}

function mainActions(state: IncarnateSessionState): Array<{ action: MainAction; label: string }> {
  const active = state.activeCharacter;
  return [
    { action: "character", label: `Choose character${active ? ` · ${active.name}` : ""}` },
    { action: "mood", label: `Choose mood${state.currentMood ? ` · ${state.currentMood}` : ""}` },
    { action: "avatar", label: `Avatar mode · ${state.avatarMode}` },
    { action: "create", label: "Create character card" },
    { action: "edit", label: "Edit character card" },
    { action: "status", label: "Show status" },
    { action: "off", label: "Disable active character" },
    { action: "close", label: "Close menu" },
  ];
}

export async function openIncarnateMenu(
  ctx: ExtensionCommandContext,
  dependencies: IncarnateMenuDependencies,
): Promise<void> {
  while (true) {
    const options = mainActions(dependencies.state);
    const selected = await ctx.ui.select("pi-incarnate", options.map((option) => option.label));
    if (!selected) return;
    const action = options.find((option) => option.label === selected)?.action;
    if (!action || action === "close") return;
    if (action === "character") await switchCharacter(ctx, dependencies);
    if (action === "mood") await chooseMood(ctx, dependencies);
    if (action === "avatar") await chooseAvatarMode(ctx, dependencies);
    if (action === "create") await createCharacter(ctx, dependencies);
    if (action === "edit") await editCharacter(ctx, dependencies);
    if (action === "status") ctx.ui.notify(statusText(dependencies.state, dependencies.locations), "info");
    if (action === "off") {
      const previous = dependencies.state.activeCharacter;
      dependencies.state.deactivate();
      await dependencies.onStateChange?.(ctx);
      ctx.ui.notify(previous ? `Character disabled: ${previous.name}` : "Character mode is already off", "info");
    }
  }
}
