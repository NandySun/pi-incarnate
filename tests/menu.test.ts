import assert from "node:assert/strict";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { createCharacterTemplate } from "../src/character-editor.ts";
import { loadCharacter } from "../src/character-loader.ts";
import { openIncarnateMenu } from "../src/menu.ts";
import { IncarnateSessionState } from "../src/session-state.ts";

const MIRA_CARD = createCharacterTemplate("Mira");

async function roots(t: TestContext): Promise<{ builtInRoot: string; personalRoot: string }> {
  const root = join(tmpdir(), `pi-incarnate-menu-${crypto.randomUUID()}`);
  const builtInRoot = join(root, "built-in");
  const personalRoot = join(root, "personal");
  await mkdir(join(builtInRoot, "mira"), { recursive: true });
  await writeFile(join(builtInRoot, "mira", "CHARACTER.md"), MIRA_CARD);
  t.after(() => rm(root, { recursive: true, force: true }));
  return { builtInRoot, personalRoot };
}

function context(options: {
  selections: string[];
  inputs?: string[];
  editorText?: string;
  confirm?: boolean;
}): { ctx: ExtensionCommandContext; notifications: string[]; menus: Array<{ title: string; items: string[] }> } {
  const notifications: string[] = [];
  const menus: Array<{ title: string; items: string[] }> = [];
  const selections = [...options.selections];
  const inputs = [...(options.inputs ?? [])];
  const ctx = {
    hasUI: true,
    mode: "tui",
    cwd: process.cwd(),
    ui: {
      async select(title: string, items: string[]) {
        menus.push({ title, items: [...items] });
        const selected = selections.shift();
        assert.ok(selected === undefined || items.includes(selected), `Unexpected menu choice: ${selected}`);
        return selected;
      },
      async input() {
        return inputs.shift();
      },
      async editor() {
        return options.editorText;
      },
      async confirm() {
        return options.confirm ?? false;
      },
      notify(message: string) {
        notifications.push(message);
      },
    },
  } as unknown as ExtensionCommandContext;
  return { ctx, notifications, menus };
}

test("main menu shows only actions relevant to an inactive session", async (t) => {
  const locations = await roots(t);
  const state = new IncarnateSessionState();
  const harness = context({ selections: ["Close menu"] });

  await openIncarnateMenu(harness.ctx, { locations, state });

  assert.deepEqual(harness.menus[0], {
    title: "pi-incarnate",
    items: ["Choose character", "Character library", "Show status", "Close menu"],
  });
});

test("main menu reveals mood, appearance, and disable actions for an active character", async (t) => {
  const locations = await roots(t);
  const state = new IncarnateSessionState();
  state.activate(await loadCharacter(locations.builtInRoot, "mira"));
  const harness = context({ selections: ["Close menu"] });

  await openIncarnateMenu(harness.ctx, { locations, state });

  assert.deepEqual(harness.menus[0], {
    title: "pi-incarnate",
    items: [
      "Change character · Mira",
      "Choose mood · normal",
      "Avatar mode · auto",
      "Character library",
      "Show status",
      "Disable active character",
      "Close menu",
    ],
  });
});

test("keyboard menu selects and activates a character", async (t) => {
  const locations = await roots(t);
  const state = new IncarnateSessionState();
  const harness = context({
    selections: ["Choose character", "Mira (mira) · built-in", "Close menu"],
  });
  let refreshes = 0;

  await openIncarnateMenu(harness.ctx, { locations, state, onStateChange: () => void (refreshes += 1) });

  assert.equal(state.activeCharacter?.id, "mira");
  assert.equal(refreshes, 1);
  assert.match(harness.notifications.at(-1) ?? "", /Character enabled: Mira/);
});

test("keyboard menu creates, validates, stores, and activates a character", async (t) => {
  const locations = await roots(t);
  const state = new IncarnateSessionState();
  const harness = context({
    selections: ["Character library", "Add or restore character", "Create character card", "Close menu"],
    inputs: ["Nova", "nova"],
    editorText: createCharacterTemplate("Nova"),
    confirm: true,
  });

  await openIncarnateMenu(harness.ctx, { locations, state });

  assert.equal(state.activeCharacter?.id, "nova");
  assert.match(await readFile(join(locations.personalRoot, "nova", "CHARACTER.md"), "utf8"), /^# Nova/);
});

test("character creation accepts a Chinese name and an automatically suggested safe id", async (t) => {
  const locations = await roots(t);
  const state = new IncarnateSessionState();
  const harness = context({
    selections: ["Character library", "Add or restore character", "Create character card", "Close menu"],
    inputs: ["星澜", ""],
    editorText: createCharacterTemplate("星澜"),
  });

  await openIncarnateMenu(harness.ctx, { locations, state });

  assert.match(await readFile(join(locations.personalRoot, "character", "CHARACTER.md"), "utf8"), /^# 星澜/);
});

test("invalid character ids stay in the prompt and common formatting is normalized", async (t) => {
  const locations = await roots(t);
  const state = new IncarnateSessionState();
  const harness = context({
    selections: ["Character library", "Add or restore character", "Create character card", "Close menu"],
    inputs: ["Nova Prime", "角色", "Nova_Prime"],
    editorText: createCharacterTemplate("Nova Prime"),
  });

  await openIncarnateMenu(harness.ctx, { locations, state });

  assert.match(await readFile(join(locations.personalRoot, "nova-prime", "CHARACTER.md"), "utf8"), /^# Nova Prime/);
  assert.ok(harness.notifications.some((message) => /name may be Chinese/.test(message)));
  assert.ok(harness.notifications.some((message) => /normalized to: nova-prime/.test(message)));
});

test("keyboard menu changes mood and avatar mode without subcommands", async (t) => {
  const locations = await roots(t);
  const state = new IncarnateSessionState();
  const harness = context({
    selections: [
      "Choose character",
      "Mira (mira) · built-in",
      "Choose mood · normal",
      "normal · active",
      "Avatar mode · auto",
      "Compact · character status only",
      "Close menu",
    ],
  });

  await openIncarnateMenu(harness.ctx, { locations, state });

  assert.equal(state.currentMood, "normal");
  assert.equal(state.avatarMode, "compact");
});

test("editing a built-in card through the menu creates a personal override", async (t) => {
  const locations = await roots(t);
  const state = new IncarnateSessionState();
  const harness = context({
    selections: ["Character library", "Edit character", "Edit complete character card", "Mira (mira) · built-in", "Close menu"],
    editorText: MIRA_CARD.replace("# Mira", "# Personal Mira"),
    confirm: true,
  });

  await openIncarnateMenu(harness.ctx, { locations, state });

  assert.match(await readFile(join(locations.personalRoot, "mira", "CHARACTER.md"), "utf8"), /^# Personal Mira/);
  assert.match(harness.notifications.at(-1) ?? "", /Character card saved: Personal Mira/);
});

test("guided editor changes one section and preserves custom content", async (t) => {
  const locations = await roots(t);
  const original = createCharacterTemplate("Nova").replace(
    "## Personality",
    "## Custom Notes\n\nKeep this exactly.\n\n## Personality",
  );
  await mkdir(join(locations.personalRoot, "nova"), { recursive: true });
  await writeFile(join(locations.personalRoot, "nova", "CHARACTER.md"), original);
  const state = new IncarnateSessionState();
  state.activate(await loadCharacter(locations.personalRoot, "nova"));
  const harness = context({
    selections: [
      "Character library",
      "Edit character",
      "Edit character sections",
      "Nova (nova) · personal",
      "Identity",
      "Close menu",
    ],
    editorText: "A guided identity.",
  });
  let refreshes = 0;

  await openIncarnateMenu(harness.ctx, {
    locations,
    state,
    onStateChange: () => void (refreshes += 1),
  });

  const saved = await readFile(join(locations.personalRoot, "nova", "CHARACTER.md"), "utf8");
  assert.match(saved, /## Identity\n\nA guided identity\./);
  assert.match(saved, /## Custom Notes\n\nKeep this exactly\./);
  assert.equal(state.activeCharacter?.sections.Identity, "A guided identity.");
  assert.equal(refreshes, 1);
});

test("guided name editing creates a personal override for a built-in character", async (t) => {
  const locations = await roots(t);
  const state = new IncarnateSessionState();
  state.activate(await loadCharacter(locations.builtInRoot, "mira"));
  const harness = context({
    selections: [
      "Character library",
      "Edit character",
      "Edit character sections",
      "Mira (mira) · built-in",
      "Display name · Mira",
      "Close menu",
    ],
    inputs: ["Personal Mira"],
    confirm: true,
  });
  let refreshes = 0;

  await openIncarnateMenu(harness.ctx, {
    locations,
    state,
    onStateChange: () => void (refreshes += 1),
  });

  assert.equal((await loadCharacter(locations.personalRoot, "mira")).name, "Personal Mira");
  assert.equal((await loadCharacter(locations.builtInRoot, "mira")).name, "Mira");
  assert.equal(state.activeCharacter?.name, "Personal Mira");
  assert.equal(refreshes, 1);
});

test("guided editor leaves the card unchanged when a section fails validation", async (t) => {
  const locations = await roots(t);
  const original = createCharacterTemplate("Nova");
  await mkdir(join(locations.personalRoot, "nova"), { recursive: true });
  await writeFile(join(locations.personalRoot, "nova", "CHARACTER.md"), original);
  const state = new IncarnateSessionState();
  const harness = context({
    selections: [
      "Character library",
      "Edit character",
      "Edit character sections",
      "Nova (nova) · personal",
      "Identity",
      "Close menu",
    ],
    editorText: "",
  });

  await openIncarnateMenu(harness.ctx, { locations, state });

  assert.equal(await readFile(join(locations.personalRoot, "nova", "CHARACTER.md"), "utf8"), original);
  assert.ok(harness.notifications.some((message) => /missing required non-empty sections: Identity/.test(message)));
});

test("keyboard menu repairs a personal card that disappeared from the valid catalog", async (t) => {
  const locations = await roots(t);
  const brokenDirectory = join(locations.personalRoot, "broken");
  await mkdir(brokenDirectory, { recursive: true });
  await writeFile(join(brokenDirectory, "CHARACTER.md"), "# Broken\n\n## Identity\nOnly one section.\n");
  const state = new IncarnateSessionState();
  const harness = context({
    selections: ["Character library", "Add or restore character", "Repair invalid character card", "broken · invalid-card", "Close menu"],
    editorText: createCharacterTemplate("Repaired Character"),
  });

  await openIncarnateMenu(harness.ctx, { locations, state });

  assert.match(await readFile(join(brokenDirectory, "CHARACTER.md"), "utf8"), /^# Repaired Character/);
  assert.match(harness.notifications.at(-1) ?? "", /Character card repaired: Repaired Character/);
});

test("keyboard menu can create a missing card from the unchanged repair template", async (t) => {
  const locations = await roots(t);
  const missingDirectory = join(locations.personalRoot, "missing-card");
  await mkdir(missingDirectory, { recursive: true });
  const state = new IncarnateSessionState();
  const template = createCharacterTemplate("missing-card");
  const harness = context({
    selections: ["Character library", "Add or restore character", "Repair invalid character card", "missing-card · missing-card", "Close menu"],
    editorText: template,
  });

  await openIncarnateMenu(harness.ctx, { locations, state });

  assert.equal(await readFile(join(missingDirectory, "CHARACTER.md"), "utf8"), template);
  assert.match(harness.notifications.at(-1) ?? "", /Character card repaired: missing-card/);
});

test("keyboard menu imports an avatar for a personal character", async (t) => {
  const locations = await roots(t);
  await mkdir(join(locations.personalRoot, "nova"), { recursive: true });
  await writeFile(join(locations.personalRoot, "nova", "CHARACTER.md"), createCharacterTemplate("Nova"));
  const source = join(dirname(locations.personalRoot), "portrait file.txt");
  await writeFile(source, "(nova)\n");
  const state = new IncarnateSessionState();
  const harness = context({
    selections: [
      "Character library",
      "Edit character",
      "Manage character avatar",
      "Nova (nova) · personal",
      "Import avatar file",
      "Close menu",
    ],
    inputs: [`'${source}'`],
  });

  await openIncarnateMenu(harness.ctx, { locations, state });

  assert.equal(await readFile(join(locations.personalRoot, "nova", "avatar.txt"), "utf8"), "(nova)\n");
  assert.match(harness.notifications.at(-1) ?? "", /Avatar imported: 6×1/);
});

test("avatar changes create a personal override and refresh an active built-in character", async (t) => {
  const locations = await roots(t);
  const source = join(dirname(locations.personalRoot), "portrait.ansi");
  await writeFile(source, "\u001b[31mface\u001b[0m\n");
  const state = new IncarnateSessionState();
  state.activate(await loadCharacter(locations.builtInRoot, "mira"));
  const harness = context({
    selections: [
      "Character library",
      "Edit character",
      "Manage character avatar",
      "Mira (mira) · built-in",
      "Import avatar file",
      "Close menu",
    ],
    inputs: [source],
    confirm: true,
  });
  let refreshes = 0;

  await openIncarnateMenu(harness.ctx, {
    locations,
    state,
    onStateChange: () => void (refreshes += 1),
  });

  assert.equal(state.activeCharacter?.directory, join(locations.personalRoot, "mira"));
  assert.match(await readFile(join(locations.personalRoot, "mira", "avatar.ansi"), "utf8"), /\u001b\[31mface/);
  assert.equal(refreshes, 1);
});

test("keyboard menu creates and activates a declared missing preference form", async (t) => {
  const locations = await roots(t);
  const novaCard = createCharacterTemplate("Nova").replace(
    "## Current Mood",
    "## Tools and Forms\n\n- Notes: `forms/notes.md`\n\n## Current Mood",
  );
  await mkdir(join(locations.personalRoot, "nova"), { recursive: true });
  await writeFile(join(locations.personalRoot, "nova", "CHARACTER.md"), novaCard);
  const state = new IncarnateSessionState();
  state.activate(await loadCharacter(locations.personalRoot, "nova"));
  const harness = context({
    selections: [
      "Character library",
      "Edit character",
      "Manage preference forms",
      "Nova (nova) · personal",
      "1. Notes · missing · forms/notes.md",
      "Close menu",
    ],
    editorText: "# Notes\n\nPrefers concise answers.\n",
  });
  let refreshes = 0;

  await openIncarnateMenu(harness.ctx, {
    locations,
    state,
    onStateChange: () => void (refreshes += 1),
  });

  assert.equal(await readFile(join(locations.personalRoot, "nova", "forms", "notes.md"), "utf8"), "# Notes\n\nPrefers concise answers.\n");
  assert.equal(state.activeCharacter?.forms[0]?.status, "available");
  assert.equal(refreshes, 1);
});

test("editing a built-in preference form creates a personal override", async (t) => {
  const locations = await roots(t);
  const cardPath = join(locations.builtInRoot, "mira", "CHARACTER.md");
  await writeFile(
    cardPath,
    MIRA_CARD.replace("## Current Mood", "## Tools and Forms\n\n- Notes: `forms/notes.md`\n\n## Current Mood"),
  );
  await mkdir(join(locations.builtInRoot, "mira", "forms"));
  await writeFile(join(locations.builtInRoot, "mira", "forms", "notes.md"), "# Notes\n\nBuilt in.\n");
  const state = new IncarnateSessionState();
  const harness = context({
    selections: [
      "Character library",
      "Edit character",
      "Manage preference forms",
      "Mira (mira) · built-in",
      "1. Notes · available · forms/notes.md",
      "Close menu",
    ],
    editorText: "# Notes\n\nPersonal.\n",
    confirm: true,
  });

  await openIncarnateMenu(harness.ctx, { locations, state });

  assert.equal(await readFile(join(locations.personalRoot, "mira", "forms", "notes.md"), "utf8"), "# Notes\n\nPersonal.\n");
  assert.equal(await readFile(join(locations.builtInRoot, "mira", "forms", "notes.md"), "utf8"), "# Notes\n\nBuilt in.\n");
});

test("character lifecycle menu renames an active personal character", async (t) => {
  const locations = await roots(t);
  await mkdir(join(locations.personalRoot, "nova"), { recursive: true });
  await writeFile(join(locations.personalRoot, "nova", "CHARACTER.md"), createCharacterTemplate("Nova"));
  const state = new IncarnateSessionState();
  state.activate(await loadCharacter(locations.personalRoot, "nova"));
  const harness = context({
    selections: [
      "Character library",
      "Manage or export character",
      "Rename personal character",
      "Nova (nova)",
      "Close menu",
    ],
    inputs: ["Nova Prime"],
    confirm: true,
  });
  let refreshes = 0;

  await openIncarnateMenu(harness.ctx, { locations, state, onStateChange: () => void (refreshes += 1) });

  assert.equal(state.activeCharacter?.id, "nova-prime");
  assert.equal(refreshes, 1);
  assert.match(await readFile(join(locations.personalRoot, "nova-prime", "CHARACTER.md"), "utf8"), /^# Nova/);
});

test("character lifecycle menu archives and restores without permanent deletion", async (t) => {
  const locations = await roots(t);
  await mkdir(join(locations.personalRoot, "nova"), { recursive: true });
  await writeFile(join(locations.personalRoot, "nova", "CHARACTER.md"), createCharacterTemplate("Nova"));
  const state = new IncarnateSessionState();
  state.activate(await loadCharacter(locations.personalRoot, "nova"));
  let refreshes = 0;
  const archiveHarness = context({
    selections: [
      "Character library",
      "Manage or export character",
      "Archive personal character",
      "Nova (nova)",
      "Close menu",
    ],
    confirm: true,
  });
  await openIncarnateMenu(archiveHarness.ctx, { locations, state, onStateChange: () => void (refreshes += 1) });

  assert.equal(state.activeCharacter, undefined);
  assert.equal(refreshes, 1);

  const restoreHarness = context({
    selections: [
      "Character library",
      "Add or restore character",
      "Restore archived character",
      "Nova (nova)",
      "Close menu",
    ],
    confirm: false,
  });
  await openIncarnateMenu(restoreHarness.ctx, { locations, state, onStateChange: () => void (refreshes += 1) });

  assert.match(await readFile(join(locations.personalRoot, "nova", "CHARACTER.md"), "utf8"), /^# Nova/);
  assert.equal(refreshes, 1);
});

test("restore menu reports an unsafe archive root without leaving the menu", async (t) => {
  const locations = await roots(t);
  await symlink(locations.builtInRoot, join(dirname(locations.personalRoot), "archive"));
  const state = new IncarnateSessionState();
  const harness = context({
    selections: [
      "Character library",
      "Add or restore character",
      "Restore archived character",
      "Close menu",
    ],
  });

  await openIncarnateMenu(harness.ctx, { locations, state });

  assert.ok(harness.notifications.some((message) => /must be a real directory/.test(message)));
});

test("character package menu exports and imports a built-in character as a personal override", async (t) => {
  const locations = await roots(t);
  const bundlePath = join(dirname(locations.personalRoot), "mira.pi-character.json");
  const state = new IncarnateSessionState();
  const exportHarness = context({
    selections: [
      "Character library",
      "Manage or export character",
      "Export character package",
      "Mira (mira) · built-in",
      "Close menu",
    ],
    inputs: [bundlePath],
    confirm: true,
  });
  await openIncarnateMenu(exportHarness.ctx, { locations, state });

  assert.match(await readFile(bundlePath, "utf8"), /"format": "pi-incarnate-character"/);
  state.activate(await loadCharacter(locations.builtInRoot, "mira"));
  let refreshes = 0;
  const importHarness = context({
    selections: [
      "Character library",
      "Add or restore character",
      "Import character package",
      "Close menu",
    ],
    inputs: [bundlePath],
    confirm: true,
  });
  await openIncarnateMenu(importHarness.ctx, {
    locations,
    state,
    onStateChange: () => void (refreshes += 1),
  });

  assert.match(await readFile(join(locations.personalRoot, "mira", "CHARACTER.md"), "utf8"), /^# Mira/);
  assert.equal(state.activeCharacter?.directory, join(locations.personalRoot, "mira"));
  assert.equal(refreshes, 1);
});
