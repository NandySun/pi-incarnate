import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import {
  installPersonalAvatar,
  prepareAvatarImport,
  removePersonalAvatars,
  resolveAvatarSourcePath,
  resolveUserPath,
} from "./avatar-manager.ts";

import {
  characterSource,
  discoverCharacterCatalog,
  type CharacterCatalogEntry,
  type CharacterLocations,
} from "./character-catalog.ts";
import {
  CHARACTER_BUNDLE_SUFFIX,
  installCharacterBundle,
  prepareCharacterBundleImport,
  writeCharacterBundle,
} from "./character-bundle.ts";
import {
  archivePersonalCharacter,
  discoverArchivedCharacters,
  renamePersonalCharacter,
  restoreArchivedCharacter,
} from "./character-lifecycle.ts";
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
import {
  GUIDED_CHARACTER_SECTIONS,
  readCharacterSection,
  sectionStarter,
  updateCharacterName,
  updateCharacterSection,
  type GuidedCharacterSection,
} from "./character-section-editor.ts";
import { readFormDraft, savePersonalForm } from "./form-editor.ts";
import { discoverCharacters, isCharacterId, loadCharacter, type Character, type CharacterIssue } from "./character-loader.ts";
import { confirmMenu, selectMenu } from "./select-menu.ts";
import type { AvatarMode, IncarnateSessionState } from "./session-state.ts";

export interface IncarnateMenuDependencies {
  locations: CharacterLocations;
  state: IncarnateSessionState;
  onStateChange?: (ctx: ExtensionCommandContext) => Promise<void> | void;
}

type MainAction = "character" | "mood" | "avatar" | "manage" | "status" | "off" | "close";
type ManageAction = "add" | "edit" | "organize" | "back";
type AddAction = "create" | "repair" | "import" | "restore" | "back";
type EditAction = "edit-sections" | "edit-complete" | "avatar-file" | "forms" | "back";
type OrganizeAction = "rename" | "archive" | "export" | "back";

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
  const selected = await selectMenu(ctx, title, [...labels, "← Back"]);
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
  const selected = await selectMenu(ctx, `Mood · ${active.name}`, [...labels, "← Back"]);
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
  const selected = await selectMenu(ctx, "Avatar mode", [...labels, "← Back"]);
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
      ctx.ui.notify(`Character already exists: ${id}. Choose a character editing action instead.`, "error");
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
    if (await confirmMenu(ctx, "Enable character?", `Use ${character.name} in this session now?`)) {
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
    const confirmed = await confirmMenu(
      ctx,
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

async function editCharacterSections(
  ctx: ExtensionCommandContext,
  dependencies: IncarnateMenuDependencies,
): Promise<void> {
  const selected = await chooseCharacter(ctx, dependencies.locations, "Edit character sections");
  if (!selected) return;
  if (selected.source === "built-in") {
    const confirmed = await confirmMenu(
      ctx,
      "Create personal copy?",
      `${selected.character.name} is built in. Editing creates a personal override that survives package updates.`,
    );
    if (!confirmed) return;
  }

  try {
    const current = await readCharacterCard(selected.character);
    const options: Array<{ action: "name" | GuidedCharacterSection | "back"; label: string }> = [
      { action: "name", label: `Display name · ${selected.character.name}` },
      ...GUIDED_CHARACTER_SECTIONS.map((name) => {
        const draft = readCharacterSection(current, name);
        const optionalStatus = name === "Current Mood" || name === "Tools and Forms"
          ? ` · ${draft.exists ? "configured" : "not configured"}`
          : "";
        return { action: name, label: `${name}${optionalStatus}` };
      }),
      { action: "back", label: "← Back" },
    ];
    const choice = await selectMenu(ctx, `Character sections · ${selected.character.name}`, options.map((option) => option.label));
    if (!choice) return;
    const action = options.find((option) => option.label === choice)?.action;
    if (!action || action === "back") return;

    let markdown: string;
    let changedLabel: string;
    if (action === "name") {
      const name = await ctx.ui.input(`Display name · current: ${selected.character.name}`, "enter a new display name");
      if (name === undefined) return;
      markdown = updateCharacterName(current, name);
      if (markdown === current.replace(/\r\n?/g, "\n")) return;
      changedLabel = "Display name";
    } else {
      const draft = readCharacterSection(current, action);
      const content = await ctx.ui.editor(
        `Edit section · ${action}`,
        draft.exists ? draft.content : sectionStarter(action),
      );
      if (content === undefined || (draft.exists && content === draft.content)) return;
      markdown = updateCharacterSection(current, action, content);
      changedLabel = action;
    }

    const character = await saveEditedCharacter(dependencies, selected, markdown);
    await refreshEditedCharacter(ctx, dependencies, character);
    ctx.ui.notify(`Character section saved: ${changedLabel}\n${character.cardPath}`, "info");
  } catch (error) {
    ctx.ui.notify(errorMessage(error, "Failed to edit character section"), "error");
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
  const selected = await selectMenu(ctx, "Repair character card", [...labels, "← Back"]);
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
  const confirmed = await confirmMenu(
    ctx,
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
  const action = await selectMenu(ctx, `Avatar file · ${selected.character.name}`, [
    "Import avatar file",
    "Remove avatar file",
    "← Back",
  ]);
  if (!action || action === "← Back") return;

  try {
    if (action === "Import avatar file") {
      const input = await ctx.ui.input("Avatar file", "path to a .png, .ansi, or .txt file; drag and drop is supported");
      if (!input?.trim()) return;
      const sourcePath = resolveAvatarSourcePath(input, ctx.cwd);
      const prepared = await prepareAvatarImport(sourcePath);
      const character = await personalCharacterForResources(ctx, dependencies, selected);
      if (!character) return;
      const targetPath = await installPersonalAvatar(personalRoot, character.id, prepared);
      await refreshEditedCharacter(ctx, dependencies, character);
      const unit = prepared.kind === "png" ? "px" : "cells";
      ctx.ui.notify(`Avatar imported: ${prepared.width}×${prepared.height} ${unit}\n${targetPath}`, "info");
      return;
    }

    const confirmed = await confirmMenu(ctx, "Remove avatar?", `Remove the personal avatar for ${selected.character.name}?`);
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

async function manageForms(ctx: ExtensionCommandContext, dependencies: IncarnateMenuDependencies): Promise<void> {
  const personalRoot = dependencies.locations.personalRoot;
  if (!personalRoot) {
    ctx.ui.notify("Personal character storage is not configured", "error");
    return;
  }
  const selected = await chooseCharacter(ctx, dependencies.locations, "Manage preference forms");
  if (!selected) return;
  if (selected.character.forms.length === 0) {
    ctx.ui.notify("No forms declared. Add a Tools and Forms section to the character card first.", "info");
    return;
  }
  const labels = selected.character.forms.map(
    (form, index) => `${index + 1}. ${form.label} · ${form.status} · ${form.declaredPath}`,
  );
  const choice = await selectMenu(ctx, `Preference forms · ${selected.character.name}`, [...labels, "← Back"]);
  if (!choice || choice === "← Back") return;
  const form = selected.character.forms[labels.indexOf(choice)];
  if (!form) return;
  if (form.status === "invalid") {
    ctx.ui.notify(`Cannot edit invalid form: ${form.reason ?? form.declaredPath}`, "error");
    return;
  }

  try {
    if (selected.source === "built-in") {
      const confirmed = await confirmMenu(
        ctx,
        "Create personal copy?",
        `${selected.character.name} is built in. Form changes require a personal override that survives package updates.`,
      );
      if (!confirmed) return;
    }
    const draft = await readFormDraft(selected.character.directory, form.declaredPath, form.label);
    const content = await ctx.ui.editor(`Edit form · ${form.label}`, draft.content);
    if (content === undefined || (draft.exists && content === draft.content)) return;

    const character = selected.source === "personal"
      ? selected.character
      : await createPersonalOverride(personalRoot, selected.character, await readCharacterCard(selected.character));
    const targetPath = await savePersonalForm(personalRoot, character.id, form.declaredPath, content);
    const refreshed = await loadCharacter(personalRoot, character.id);
    await refreshEditedCharacter(ctx, dependencies, refreshed);
    ctx.ui.notify(`Preference form saved: ${form.label}\n${targetPath}`, "info");
  } catch (error) {
    ctx.ui.notify(errorMessage(error, "Failed to edit preference form"), "error");
  }
}

async function choosePersonalCharacter(
  ctx: ExtensionCommandContext,
  locations: CharacterLocations,
  title: string,
): Promise<Character | undefined> {
  const { entries } = await discoverCharacterCatalog(locations);
  const characters = entries.filter((entry) => entry.source === "personal").map((entry) => entry.character);
  if (characters.length === 0) {
    ctx.ui.notify("No personal characters found", "info");
    return undefined;
  }
  const labels = characters.map((character) => `${character.name} (${character.id})`);
  const selected = await selectMenu(ctx, title, [...labels, "← Back"]);
  if (!selected || selected === "← Back") return undefined;
  return characters[labels.indexOf(selected)];
}

function normalizeCharacterId(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "");
}

async function renameCharacter(ctx: ExtensionCommandContext, dependencies: IncarnateMenuDependencies): Promise<void> {
  const personalRoot = dependencies.locations.personalRoot;
  if (!personalRoot) return;
  const character = await choosePersonalCharacter(ctx, dependencies.locations, "Rename personal character");
  if (!character) return;
  const input = await ctx.ui.input("New character id", "lowercase letters, numbers, and interior hyphens");
  if (input === undefined) return;
  const nextId = normalizeCharacterId(input);
  if (!isCharacterId(nextId)) {
    ctx.ui.notify("Invalid character id", "error");
    return;
  }
  const { entries } = await discoverCharacterCatalog(dependencies.locations);
  if (entries.some((entry) => entry.character.id === nextId && nextId !== character.id)) {
    ctx.ui.notify(`Character id already exists: ${nextId}`, "error");
    return;
  }
  if (!(await confirmMenu(ctx, "Rename character?", `${character.id} → ${nextId}`))) return;
  try {
    const renamed = await renamePersonalCharacter(personalRoot, character.id, nextId);
    if (dependencies.state.activeCharacter?.id === character.id) {
      dependencies.state.activate(renamed);
      await dependencies.onStateChange?.(ctx);
    }
    ctx.ui.notify(`Character renamed: ${renamed.name} (${renamed.id})`, "info");
  } catch (error) {
    ctx.ui.notify(errorMessage(error, "Failed to rename character"), "error");
  }
}

async function archiveCharacter(ctx: ExtensionCommandContext, dependencies: IncarnateMenuDependencies): Promise<void> {
  const personalRoot = dependencies.locations.personalRoot;
  if (!personalRoot) return;
  const character = await choosePersonalCharacter(ctx, dependencies.locations, "Archive personal character");
  if (!character) return;
  if (!(await confirmMenu(ctx, "Archive character?", `${character.name} will leave the active character list but can be restored.`))) return;
  try {
    const target = await archivePersonalCharacter(personalRoot, character.id);
    if (dependencies.state.activeCharacter?.id === character.id) {
      dependencies.state.deactivate();
      await dependencies.onStateChange?.(ctx);
    }
    ctx.ui.notify(`Character archived: ${character.name}\n${target}`, "info");
  } catch (error) {
    ctx.ui.notify(errorMessage(error, "Failed to archive character"), "error");
  }
}

async function restoreCharacter(ctx: ExtensionCommandContext, dependencies: IncarnateMenuDependencies): Promise<void> {
  const personalRoot = dependencies.locations.personalRoot;
  if (!personalRoot) return;
  let characters: Character[];
  let issues: CharacterIssue[];
  try {
    ({ characters, issues } = await discoverArchivedCharacters(personalRoot));
  } catch (error) {
    ctx.ui.notify(errorMessage(error, "Failed to inspect character archive"), "error");
    return;
  }
  if (characters.length === 0) {
    ctx.ui.notify(issues.length > 0 ? "No valid archived characters found" : "Character archive is empty", "info");
    return;
  }
  const labels = characters.map((character) => `${character.name} (${character.id})`);
  const selected = await selectMenu(ctx, "Restore archived character", [...labels, "← Back"]);
  if (!selected || selected === "← Back") return;
  const archived = characters[labels.indexOf(selected)];
  if (!archived) return;
  try {
    const restored = await restoreArchivedCharacter(personalRoot, archived.id);
    ctx.ui.notify(`Character restored: ${restored.name} (${restored.id})`, "info");
    if (await confirmMenu(ctx, "Enable character?", `Use ${restored.name} in this session now?`)) {
      dependencies.state.activate(restored);
      await dependencies.onStateChange?.(ctx);
    }
  } catch (error) {
    ctx.ui.notify(errorMessage(error, "Failed to restore character"), "error");
  }
}

async function exportCharacterBundle(
  ctx: ExtensionCommandContext,
  dependencies: IncarnateMenuDependencies,
): Promise<void> {
  const selected = await chooseCharacter(ctx, dependencies.locations, "Export character package");
  if (!selected) return;
  const filename = `${selected.character.id}${CHARACTER_BUNDLE_SUFFIX}`;
  const input = await ctx.ui.input(`Export file · default: ${filename}`, "leave empty to use the current directory");
  if (input === undefined) return;
  const availableForms = selected.character.forms.filter((form) => form.status === "available").length;
  try {
    const targetPath = resolveUserPath(input.trim() || filename, ctx.cwd);
    const confirmed = await confirmMenu(
      ctx,
      "Export character package?",
      `Includes the character card, preferred avatar, and ${availableForms} available declared form(s). Preference forms may contain private information.`,
    );
    if (!confirmed) return;
    const summary = await writeCharacterBundle(selected.character, targetPath);
    ctx.ui.notify(
      `Character package exported: ${summary.name}\nAvatar: ${summary.avatarIncluded ? "included" : "none"} · Forms: ${summary.formsIncluded}/${summary.formsDeclared}\n${targetPath}`,
      "info",
    );
  } catch (error) {
    ctx.ui.notify(errorMessage(error, "Failed to export character package"), "error");
  }
}

async function importCharacterBundle(
  ctx: ExtensionCommandContext,
  dependencies: IncarnateMenuDependencies,
): Promise<void> {
  const personalRoot = dependencies.locations.personalRoot;
  if (!personalRoot) {
    ctx.ui.notify("Personal character storage is not configured", "error");
    return;
  }
  const input = await ctx.ui.input("Character package", `path to a *${CHARACTER_BUNDLE_SUFFIX} file`);
  if (!input?.trim()) return;
  try {
    const sourcePath = resolveUserPath(input, ctx.cwd);
    const bundle = await prepareCharacterBundleImport(sourcePath);
    const confirmed = await confirmMenu(
      ctx,
      "Import character package?",
      `${bundle.name} (${bundle.id}) · Avatar: ${bundle.avatars.length > 0 ? "included" : "none"} · Forms: ${bundle.forms.length}. Existing personal characters are never overwritten.`,
    );
    if (!confirmed) return;
    const character = await installCharacterBundle(personalRoot, bundle);
    ctx.ui.notify(`Character package imported: ${character.name} (${character.id})\n${character.directory}`, "info");
    if (dependencies.state.activeCharacter?.id === character.id) {
      dependencies.state.activate(character);
      await dependencies.onStateChange?.(ctx);
    } else if (await confirmMenu(ctx, "Enable character?", `Use ${character.name} in this session now?`)) {
      dependencies.state.activate(character);
      await dependencies.onStateChange?.(ctx);
    }
  } catch (error) {
    ctx.ui.notify(errorMessage(error, "Failed to import character package"), "error");
  }
}

async function manageAddCharacter(
  ctx: ExtensionCommandContext,
  dependencies: IncarnateMenuDependencies,
): Promise<void> {
  const options: Array<{ action: AddAction; label: string }> = [
    { action: "create", label: "Create character card" },
    { action: "repair", label: "Repair invalid character card" },
    { action: "import", label: "Import character package" },
    { action: "restore", label: "Restore archived character" },
    { action: "back", label: "← Back" },
  ];
  const selected = await selectMenu(ctx, "Add or restore character", options.map((option) => option.label));
  if (!selected) return;
  const action = options.find((option) => option.label === selected)?.action;
  if (!action || action === "back") return;
  if (action === "create") await createCharacter(ctx, dependencies);
  if (action === "repair") await repairCharacter(ctx, dependencies);
  if (action === "import") await importCharacterBundle(ctx, dependencies);
  if (action === "restore") await restoreCharacter(ctx, dependencies);
}

async function manageCharacterEditing(
  ctx: ExtensionCommandContext,
  dependencies: IncarnateMenuDependencies,
): Promise<void> {
  const options: Array<{ action: EditAction; label: string }> = [
    { action: "edit-sections", label: "Edit character sections" },
    { action: "edit-complete", label: "Edit complete character card" },
    { action: "avatar-file", label: "Manage character avatar" },
    { action: "forms", label: "Manage preference forms" },
    { action: "back", label: "← Back" },
  ];
  const selected = await selectMenu(ctx, "Edit character", options.map((option) => option.label));
  if (!selected) return;
  const action = options.find((option) => option.label === selected)?.action;
  if (!action || action === "back") return;
  if (action === "edit-sections") await editCharacterSections(ctx, dependencies);
  if (action === "edit-complete") await editCharacter(ctx, dependencies);
  if (action === "avatar-file") await manageAvatarFile(ctx, dependencies);
  if (action === "forms") await manageForms(ctx, dependencies);
}

async function manageCharacterOrganization(
  ctx: ExtensionCommandContext,
  dependencies: IncarnateMenuDependencies,
): Promise<void> {
  const options: Array<{ action: OrganizeAction; label: string }> = [
    { action: "rename", label: "Rename personal character" },
    { action: "archive", label: "Archive personal character" },
    { action: "export", label: "Export character package" },
    { action: "back", label: "← Back" },
  ];
  const selected = await selectMenu(ctx, "Manage or export character", options.map((option) => option.label));
  if (!selected) return;
  const action = options.find((option) => option.label === selected)?.action;
  if (!action || action === "back") return;
  if (action === "rename") await renameCharacter(ctx, dependencies);
  if (action === "archive") await archiveCharacter(ctx, dependencies);
  if (action === "export") await exportCharacterBundle(ctx, dependencies);
}

async function manageCharacterResources(
  ctx: ExtensionCommandContext,
  dependencies: IncarnateMenuDependencies,
): Promise<void> {
  const options: Array<{ action: ManageAction; label: string }> = [
    { action: "add", label: "Add or restore character" },
    { action: "edit", label: "Edit character" },
    { action: "organize", label: "Manage or export character" },
    { action: "back", label: "← Main menu" },
  ];
  const selected = await selectMenu(ctx, "Character library", options.map((option) => option.label));
  if (!selected) return;
  const action = options.find((option) => option.label === selected)?.action;
  if (!action || action === "back") return;
  if (action === "add") await manageAddCharacter(ctx, dependencies);
  if (action === "edit") await manageCharacterEditing(ctx, dependencies);
  if (action === "organize") await manageCharacterOrganization(ctx, dependencies);
}

function mainActions(state: IncarnateSessionState): Array<{ action: MainAction; label: string }> {
  const active = state.activeCharacter;
  const actions: Array<{ action: MainAction; label: string }> = [
    { action: "character", label: active ? `Change character · ${active.name}` : "Choose character" },
  ];
  if (active?.mood.presets.size) {
    actions.push({ action: "mood", label: `Choose mood${state.currentMood ? ` · ${state.currentMood}` : ""}` });
  }
  if (active) {
    actions.push({ action: "avatar", label: `Avatar mode · ${state.avatarMode}` });
  }
  actions.push(
    { action: "manage", label: "Character library" },
    { action: "status", label: "Show status" },
  );
  if (active) actions.push({ action: "off", label: "Disable active character" });
  actions.push({ action: "close", label: "Close menu" });
  return actions;
}

export async function openIncarnateMenu(
  ctx: ExtensionCommandContext,
  dependencies: IncarnateMenuDependencies,
): Promise<void> {
  while (true) {
    const options = mainActions(dependencies.state);
    const selected = await selectMenu(ctx, "pi-incarnate", options.map((option) => option.label));
    if (!selected) return;
    const action = options.find((option) => option.label === selected)?.action;
    if (!action || action === "close") return;
    if (action === "character") await switchCharacter(ctx, dependencies);
    if (action === "mood") await chooseMood(ctx, dependencies);
    if (action === "avatar") await chooseAvatarMode(ctx, dependencies);
    if (action === "manage") await manageCharacterResources(ctx, dependencies);
    if (action === "status") ctx.ui.notify(statusText(dependencies.state, dependencies.locations), "info");
    if (action === "off") {
      const previous = dependencies.state.activeCharacter;
      dependencies.state.deactivate();
      await dependencies.onStateChange?.(ctx);
      ctx.ui.notify(previous ? `Character disabled: ${previous.name}` : "Character mode is already off", "info");
    }
  }
}
