import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import {
  installPersonalAvatar,
  prepareAvatarImport,
  removePersonalAvatars,
  resolveAvatarSourcePath,
} from "./avatar-manager.ts";

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
  readPersonalCharacterDraft,
  updatePersonalCharacter,
} from "./character-editor.ts";
import { discoverCharacters, isCharacterId, type Character, type CharacterIssue } from "./character-loader.ts";
import type { AvatarMode, IncarnateSessionState } from "./session-state.ts";

export interface IncarnateMenuDependencies {
  locations: CharacterLocations;
  state: IncarnateSessionState;
  onStateChange?: (ctx: ExtensionCommandContext) => Promise<void> | void;
}

type MainAction = "character" | "mood" | "avatar" | "avatar-file" | "create" | "edit" | "repair" | "status" | "off" | "close";

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
    { mode: "auto", label: "Auto · responsive portrait/status" },
    { mode: "full", label: "Full · prefer portrait preview" },
    { mode: "compact", label: "Compact · character status only" },
    { mode: "off", label: "Off · hide character UI" },
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
  name: string,
): Promise<string | undefined> {
  const { entries } = await discoverCharacterCatalog(locations);
  const existingIds = new Set(entries.map((entry) => entry.character.id));
  const normalizedName = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = isCharacterId(normalizedName) ? normalizedName : "character";
  let suggestion = base;
  let suffix = 2;
  while (existingIds.has(suggestion)) suggestion = `${base}-${suffix++}`;

  while (true) {
    const value = await ctx.ui.input(`Character id · suggested: ${suggestion}`, "leave empty to use suggestion");
    if (value === undefined) return undefined;
    const raw = value.trim();
    const id = raw
      ? raw.toLowerCase().replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "")
      : suggestion;
    if (!isCharacterId(id)) {
      ctx.ui.notify("Use English letters or numbers for the id; spaces become hyphens. The character name may be Chinese.", "error");
      continue;
    }
    if (existingIds.has(id)) {
      ctx.ui.notify(`Character already exists: ${id}. Choose Edit character card instead.`, "error");
      continue;
    }
    if (raw && raw !== id) ctx.ui.notify(`Character id normalized to: ${id}`, "info");
    return id;
  }
}

async function promptForCharacterName(ctx: ExtensionCommandContext): Promise<string | undefined> {
  while (true) {
    const value = await ctx.ui.input("Character name", "Chinese and other languages are supported");
    if (value === undefined) return undefined;
    const name = value.trim().replace(/[\r\n]+/g, " ");
    if (name) return name;
    ctx.ui.notify("Character name must not be empty", "error");
  }
}

async function createCharacter(ctx: ExtensionCommandContext, dependencies: IncarnateMenuDependencies): Promise<void> {
  const personalRoot = dependencies.locations.personalRoot;
  if (!personalRoot) {
    ctx.ui.notify("Personal character storage is not configured", "error");
    return;
  }
  const name = await promptForCharacterName(ctx);
  if (!name) return;
  const id = await promptForCharacterId(ctx, dependencies.locations, name);
  if (!id) return;
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

function repairableIssue(issue: CharacterIssue): boolean {
  return issue.code === "invalid-card" || issue.code === "missing-card";
}

async function repairCharacter(ctx: ExtensionCommandContext, dependencies: IncarnateMenuDependencies): Promise<void> {
  const personalRoot = dependencies.locations.personalRoot;
  if (!personalRoot) {
    ctx.ui.notify("Personal character storage is not configured", "error");
    return;
  }
  const issues = (await discoverCharacters(personalRoot)).issues.filter(repairableIssue);
  if (issues.length === 0) {
    ctx.ui.notify("No repairable personal character cards found", "info");
    return;
  }

  const labels = issues.map((issue) => `${issue.id} · ${issue.code}`);
  const selected = await ctx.ui.select("Repair character card", [...labels, "← Back"]);
  if (!selected || selected === "← Back") return;
  const issue = issues[labels.indexOf(selected)];
  if (!issue) return;

  try {
    const current = issue.code === "missing-card"
      ? createCharacterTemplate(issue.id)
      : await readPersonalCharacterDraft(personalRoot, issue.id);
    const markdown = await ctx.ui.editor(`Repair ${issue.id} · ${issue.code}`, current);
    if (markdown === undefined || (issue.code !== "missing-card" && markdown === current)) return;
    const character = await updatePersonalCharacter(personalRoot, issue.id, markdown);
    if (dependencies.state.activeCharacter?.id === character.id) {
      dependencies.state.activate(character);
      await dependencies.onStateChange?.(ctx);
    }
    ctx.ui.notify(`Character card repaired: ${character.name}\n${character.cardPath}`, "info");
  } catch (error) {
    ctx.ui.notify(errorMessage(error, "Failed to repair character"), "error");
  }
}

async function personalCharacterForResources(
  ctx: ExtensionCommandContext,
  dependencies: IncarnateMenuDependencies,
  selected: CharacterCatalogEntry,
): Promise<Character | undefined> {
  const personalRoot = dependencies.locations.personalRoot;
  if (!personalRoot) throw new CharacterEditError("Personal character storage is not configured");
  if (selected.source === "personal") return selected.character;
  const confirmed = await ctx.ui.confirm(
    "Create personal copy?",
    `${selected.character.name} is built in. Avatar changes require a personal override that survives package updates.`,
  );
  if (!confirmed) return undefined;
  const markdown = await readCharacterCard(selected.character);
  return await createPersonalOverride(personalRoot, selected.character, markdown);
}

async function refreshEditedCharacter(
  ctx: ExtensionCommandContext,
  dependencies: IncarnateMenuDependencies,
  character: Character,
): Promise<void> {
  if (dependencies.state.activeCharacter?.id !== character.id) return;
  dependencies.state.activate(character);
  await dependencies.onStateChange?.(ctx);
}

async function manageAvatarFile(ctx: ExtensionCommandContext, dependencies: IncarnateMenuDependencies): Promise<void> {
  const personalRoot = dependencies.locations.personalRoot;
  if (!personalRoot) {
    ctx.ui.notify("Personal character storage is not configured", "error");
    return;
  }
  const selected = await chooseCharacter(ctx, dependencies.locations, "Manage character avatar");
  if (!selected) return;
  const action = await ctx.ui.select(`Avatar file · ${selected.character.name}`, [
    "Import avatar file",
    "Remove avatar file",
    "← Back",
  ]);
  if (!action || action === "← Back") return;

  try {
    if (action === "Import avatar file") {
      const input = await ctx.ui.input("Avatar file", "path to a .ansi or .txt file; drag and drop is supported");
      if (!input?.trim()) return;
      const sourcePath = resolveAvatarSourcePath(input, ctx.cwd);
      const prepared = await prepareAvatarImport(sourcePath);
      const character = await personalCharacterForResources(ctx, dependencies, selected);
      if (!character) return;
      const targetPath = await installPersonalAvatar(personalRoot, character.id, prepared);
      await refreshEditedCharacter(ctx, dependencies, character);
      ctx.ui.notify(`Avatar imported: ${prepared.width}×${prepared.height}\n${targetPath}`, "info");
      return;
    }

    const confirmed = await ctx.ui.confirm("Remove avatar?", `Remove the personal avatar for ${selected.character.name}?`);
    if (!confirmed) return;
    const character = await personalCharacterForResources(ctx, dependencies, selected);
    if (!character) return;
    const removed = await removePersonalAvatars(personalRoot, character.id);
    await refreshEditedCharacter(ctx, dependencies, character);
    ctx.ui.notify(removed > 0 ? `Avatar removed: ${character.name}` : `${character.name} has no personal avatar`, "info");
  } catch (error) {
    ctx.ui.notify(errorMessage(error, "Failed to manage avatar"), "error");
  }
}

function mainActions(state: IncarnateSessionState): Array<{ action: MainAction; label: string }> {
  const active = state.activeCharacter;
  return [
    { action: "character", label: `Choose character${active ? ` · ${active.name}` : ""}` },
    { action: "mood", label: `Choose mood${state.currentMood ? ` · ${state.currentMood}` : ""}` },
    { action: "avatar", label: `Avatar mode · ${state.avatarMode}` },
    { action: "avatar-file", label: "Manage character avatar" },
    { action: "create", label: "Create character card" },
    { action: "edit", label: "Edit character card" },
    { action: "repair", label: "Repair invalid character card" },
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
    if (action === "avatar-file") await manageAvatarFile(ctx, dependencies);
    if (action === "create") await createCharacter(ctx, dependencies);
    if (action === "edit") await editCharacter(ctx, dependencies);
    if (action === "repair") await repairCharacter(ctx, dependencies);
    if (action === "status") ctx.ui.notify(statusText(dependencies.state, dependencies.locations), "info");
    if (action === "off") {
      const previous = dependencies.state.activeCharacter;
      dependencies.state.deactivate();
      await dependencies.onStateChange?.(ctx);
      ctx.ui.notify(previous ? `Character disabled: ${previous.name}` : "Character mode is already off", "info");
    }
  }
}
