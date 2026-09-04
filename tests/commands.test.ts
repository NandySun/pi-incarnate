import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  RegisteredCommand,
} from "@earendil-works/pi-coding-agent";

import { registerIncarnateCommand } from "../src/commands.ts";
import { IncarnateSessionState } from "../src/session-state.ts";

const CARD = `# Mira

## Identity
Archivist.

## Personality
Curious.

## Speech Style
Concise.

## Behavior
Honest.
`;

async function fixture(t: TestContext): Promise<string> {
  const root = join(tmpdir(), `pi-incarnate-command-${crypto.randomUUID()}`);
  await mkdir(join(root, "mira"), { recursive: true });
  await writeFile(join(root, "mira", "CHARACTER.md"), CARD);
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function setup(charactersRoot: string): {
  command: RegisteredCommand;
  state: IncarnateSessionState;
  notifications: Array<{ message: string; type: string | undefined }>;
  context: ExtensionCommandContext;
  getUpdateCount: () => number;
} {
  let command: RegisteredCommand | undefined;
  const pi = {
    registerCommand(name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">) {
      command = {
        ...options,
        name,
        sourceInfo: { path: "test", source: "cli", scope: "temporary", origin: "top-level" },
      };
    },
  } as unknown as ExtensionAPI;
  const notifications: Array<{ message: string; type: string | undefined }> = [];
  const context = {
    ui: {
      notify(message: string, type?: string) {
        notifications.push({ message, type });
      },
    },
  } as unknown as ExtensionCommandContext;
  const state = new IncarnateSessionState();
  let updateCount = 0;
  registerIncarnateCommand(pi, { charactersRoot, state, onStateChange: () => void (updateCount += 1) });
  assert.ok(command);
  return { command, state, notifications, context, getUpdateCount: () => updateCount };
}

test("use, status, and off update session state", async (t) => {
  const harness = setup(await fixture(t));

  await harness.command.handler("use mira", harness.context);
  assert.equal(harness.state.activeCharacter?.id, "mira");

  await harness.command.handler("status", harness.context);
  assert.match(harness.notifications.at(-1)?.message ?? "", /Active character: Mira \(mira\)/);

  await harness.command.handler("off", harness.context);
  assert.equal(harness.state.activeCharacter, undefined);
});

test("failed switch preserves the active character", async (t) => {
  const harness = setup(await fixture(t));
  await harness.command.handler("use mira", harness.context);

  await harness.command.handler("use missing", harness.context);

  assert.equal(harness.state.activeCharacter?.id, "mira");
  assert.equal(harness.notifications.at(-1)?.type, "error");
});

test("list identifies the active character", async (t) => {
  const harness = setup(await fixture(t));
  await harness.command.handler("use mira", harness.context);

  await harness.command.handler("list", harness.context);

  assert.match(harness.notifications.at(-1)?.message ?? "", /mira — Mira \(active\)/);
});

test("mood and avatar commands validate and refresh presentation state", async (t) => {
  const charactersRoot = await fixture(t);
  await writeFile(
    join(charactersRoot, "mira", "CHARACTER.md"),
    `${CARD}\n## Current Mood\nDefault: warm\n\n### warm\nBe patient.\n\n### focused\nLead with the result.\n`,
  );
  const harness = setup(charactersRoot);
  await harness.command.handler("use mira", harness.context);

  await harness.command.handler("mood focused", harness.context);
  await harness.command.handler("avatar off", harness.context);

  assert.equal(harness.state.currentMood, "focused");
  assert.equal(harness.state.avatarEnabled, false);
  assert.equal(harness.getUpdateCount(), 3);

  await harness.command.handler("mood missing", harness.context);
  assert.equal(harness.state.currentMood, "focused");
  assert.equal(harness.notifications.at(-1)?.type, "error");
});
