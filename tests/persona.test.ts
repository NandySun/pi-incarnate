import assert from "node:assert/strict";
import { test } from "node:test";

import type { Character } from "../src/character-loader.ts";
import { appendPersonaPrompt, composePersonaPrompt } from "../src/persona.ts";

const character: Character = {
  id: "mira",
  name: "Mira",
  directory: "/characters/mira",
  cardPath: "/characters/mira/CHARACTER.md",
  markdown: "# Mira\n\n## Identity\nArchivist",
  mood: {
    defaultPreset: "focused",
    presets: new Map([["focused", { id: "focused", instruction: "Lead with the conclusion." }]]),
  },
  forms: [
    {
      label: "Games",
      declaredPath: "forms/games.md",
      resolvedPath: "/characters/mira/forms/games.md",
      status: "available",
    },
  ],
  sections: {
    Identity: "Archivist",
    Personality: "Curious",
    "Speech Style": "Concise",
    Behavior: "Honest",
  },
};

test("persona prompt includes runtime boundaries and the complete card", () => {
  const prompt = composePersonaPrompt(character);
  assert.match(prompt, /Preserve Pi's existing tools, permissions, safety rules/);
  assert.match(prompt, /Never invent tool results/);
  assert.match(prompt, /<character-card>[\s\S]*# Mira[\s\S]*<\/character-card>/);
});

test("persona layer is appended without replacing the Pi prompt", () => {
  const prompt = appendPersonaPrompt("BASE SYSTEM PROMPT", character, "focused");
  assert.ok(prompt.startsWith("BASE SYSTEM PROMPT\n\n"));
  assert.match(prompt, /Active character: Mira \(mira\)/);
  assert.match(prompt, /Current mood preset: focused/);
  assert.match(prompt, /forms\/games\.md \(available\)/);
});
