import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import type { Character } from "../src/character-loader.ts";
import {
  AVATAR_MAX_BYTES,
  AvatarLoadError,
  loadAvatar,
  sanitizeAnsiAvatar,
  sanitizeAvatar,
} from "../src/avatar.ts";

const character = {
  id: "mira",
  name: "弥拉",
  directory: "/characters/mira",
  cardPath: "/characters/mira/CHARACTER.md",
  markdown: "# Mira",
  sections: {
    Identity: "Archivist",
    Personality: "Curious",
    "Speech Style": "Concise",
    Behavior: "Honest",
  },
  mood: { presets: new Map() },
  forms: [],
} as unknown as Character;

test("removes terminal control sequences and expands tabs", () => {
  const avatar = sanitizeAvatar("\u001b[31mred\u001b[0m\tface\u0007");
  assert.deepEqual(avatar.lines, ["red    face"]);
});

test("limits avatar display columns and line count", () => {
  const avatar = sanitizeAvatar(["界".repeat(30), ...Array.from({ length: 20 }, (_, index) => `line ${index}`)].join("\n"));
  assert.equal(avatar.lines.length, 16);
  assert.ok(avatar.lines.every((line) => visibleWidth(line) <= 48));
  assert.equal(avatar.truncated, true);
});

test("ANSI avatars preserve only safe foreground and background colors", () => {
  const raw = [
    "\u001b[38;2;4;49;104m\u001b[48;2;170;230;245m▄\u001b[0m  ",
    "\u001b[31mred\u001b[39m\u001b[2J\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007",
  ].join("\n");

  const result = sanitizeAnsiAvatar(raw);

  assert.match(result.lines[0] ?? "", /\u001b\[38;2;4;49;104m/);
  assert.match(result.lines[0] ?? "", /\u001b\[48;2;170;230;245m/);
  assert.match(result.lines[1] ?? "", /\u001b\[31mred\u001b\[39m/);
  assert.doesNotMatch(result.lines.join(""), /\u001b\[2J|\u001b\]8/);
  assert.ok(result.lines.every((line) => line.endsWith("\u001b[0m")));
});

test("ANSI avatars preserve fixed canvas spacing and visible width", () => {
  const result = sanitizeAnsiAvatar("\n  \u001b[38;2;1;2;3m▄\u001b[0m   \n \u001b[48;5;42m▀\u001b[0m    \n\n");

  assert.equal(result.lines.length, 2);
  assert.equal(visibleWidth(result.lines[0] ?? ""), 6);
  assert.equal(visibleWidth(result.lines[1] ?? ""), 6);
});

async function avatarCharacter(t: TestContext): Promise<Character> {
  const directory = join(tmpdir(), `pi-incarnate-avatar-${crypto.randomUUID()}`);
  await mkdir(directory);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { ...character, directory, cardPath: join(directory, "CHARACTER.md") };
}

test("loadAvatar prefers avatar.ansi over avatar.txt", async (t) => {
  const target = await avatarCharacter(t);
  await writeFile(join(target.directory, "avatar.txt"), "plain\n");
  await writeFile(join(target.directory, "avatar.ansi"), "\u001b[38;2;1;2;3mcolor\u001b[0m\n");

  const loaded = await loadAvatar(target);

  assert.match(loaded?.lines[0] ?? "", /\u001b\[38;2;1;2;3mcolor/);
});

test("loadAvatar rejects oversized avatar files", async (t) => {
  const target = await avatarCharacter(t);
  await writeFile(join(target.directory, "avatar.ansi"), Buffer.alloc(AVATAR_MAX_BYTES + 1, 32));

  await assert.rejects(loadAvatar(target), AvatarLoadError);
});
