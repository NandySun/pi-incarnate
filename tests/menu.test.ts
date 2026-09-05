import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { createCharacterTemplate } from "../src/character-editor.ts";
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
}): { ctx: ExtensionCommandContext; notifications: string[] } {
  const notifications: string[] = [];
  const selections = [...options.selections];
  const inputs = [...(options.inputs ?? [])];
  const ctx = {
    hasUI: true,
    mode: "tui",
    ui: {
      async select(_title: string, items: string[]) {
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
  return { ctx, notifications };
}

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
    selections: ["Create character card", "Close menu"],
    inputs: ["nova", "Nova"],
    editorText: createCharacterTemplate("Nova"),
    confirm: true,
  });

  await openIncarnateMenu(harness.ctx, { locations, state });

  assert.equal(state.activeCharacter?.id, "nova");
  assert.match(await readFile(join(locations.personalRoot, "nova", "CHARACTER.md"), "utf8"), /^# Nova/);
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
      "Compact · status only",
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
    selections: ["Edit character card", "Mira (mira) · built-in", "Close menu"],
    editorText: MIRA_CARD.replace("# Mira", "# Personal Mira"),
    confirm: true,
  });

  await openIncarnateMenu(harness.ctx, { locations, state });

  assert.match(await readFile(join(locations.personalRoot, "mira", "CHARACTER.md"), "utf8"), /^# Personal Mira/);
  assert.match(harness.notifications.at(-1) ?? "", /Character card saved: Personal Mira/);
});
