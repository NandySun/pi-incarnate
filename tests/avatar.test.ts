import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import type { Character } from "../src/character-loader.ts";
import { renderAvatarWidget, resolveAvatarMode, sanitizeAvatar } from "../src/avatar.ts";

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

const avatar = sanitizeAvatar(" /\\_/\\\n( o.o )\n > ^ <");

test("removes terminal control sequences and expands tabs", () => {
  const avatar = sanitizeAvatar("\u001b[31mred\u001b[0m\tface\u0007");
  assert.deepEqual(avatar.lines, ["red    face"]);
});

test("limits avatar display columns and line count", () => {
  const avatar = sanitizeAvatar(["界".repeat(30), ...Array.from({ length: 15 }, (_, index) => `line ${index}`)].join("\n"));
  assert.equal(avatar.lines.length, 12);
  assert.ok(avatar.lines.every((line) => visibleWidth(line) <= 48));
  assert.equal(avatar.truncated, true);
});

test("compact mode renders only the status header", () => {
  assert.deepEqual(renderAvatarWidget(character, "warm", avatar, 100, "compact"), [
    "pi-incarnate · 弥拉 · mood: warm",
  ]);
});

test("auto mode uses the full right-aligned avatar when enough width is available", () => {
  const lines = renderAvatarWidget(character, "warm", avatar, 100, "auto");

  assert.equal(resolveAvatarMode("auto", 100, "pi-incarnate · 弥拉 · mood: warm", avatar), "full");
  assert.equal(lines.length, avatar.lines.length);
  assert.match(lines[0] ?? "", /^pi-incarnate · 弥拉 · mood: warm\s+ \/\\_\/\\$/);
  assert.ok(lines.every((line) => visibleWidth(line) <= 100));
  assert.ok(lines.slice(1).every((line) => visibleWidth(line) === 100));
});

test("auto mode collapses to the status header in a narrow terminal", () => {
  const lines = renderAvatarWidget(character, "warm", avatar, 60, "auto");

  assert.equal(resolveAvatarMode("auto", 60, lines[0] ?? "", avatar), "compact");
  assert.deepEqual(lines, ["pi-incarnate · 弥拉 · mood: warm"]);
});

test("forced full mode stays within the supplied terminal width", () => {
  const lines = renderAvatarWidget(character, "warm", avatar, 18, "full");

  assert.equal(lines.length, avatar.lines.length + 1);
  assert.ok(lines.every((line) => visibleWidth(line) <= 18));
});
