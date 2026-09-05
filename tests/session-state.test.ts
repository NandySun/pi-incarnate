import assert from "node:assert/strict";
import { test } from "node:test";

import type { Character } from "../src/character-loader.ts";
import { IncarnateSessionState } from "../src/session-state.ts";

const character = {
  id: "mira",
  name: "Mira",
  directory: "/characters/mira",
  cardPath: "/characters/mira/CHARACTER.md",
  markdown: "# Mira",
  sections: {
    Identity: "Archivist",
    Personality: "Curious",
    "Speech Style": "Concise",
    Behavior: "Honest",
  },
  mood: {
    defaultPreset: "warm",
    presets: new Map([["warm", { id: "warm", instruction: "Be warm." }]]),
  },
  forms: [],
} satisfies Character;

test("session state activates and deactivates a character", () => {
  const state = new IncarnateSessionState();
  assert.equal(state.activeCharacter, undefined);
  assert.equal(state.avatarMode, "auto");

  state.activate(character);
  assert.equal(state.snapshot().activeCharacter, character);
  assert.equal(state.currentMood, "warm");

  state.setAvatarMode("full");
  assert.equal(state.avatarMode, "full");
  assert.equal(state.avatarEnabled, true);

  state.setAvatarEnabled(false);
  assert.equal(state.avatarEnabled, false);
  assert.equal(state.avatarMode, "off");

  state.setAvatarEnabled(true);
  assert.equal(state.avatarMode, "auto");

  state.deactivate();
  assert.equal(state.activeCharacter, undefined);
  assert.equal(state.currentMood, undefined);

  state.reset();
  assert.equal(state.avatarEnabled, true);
  assert.equal(state.avatarMode, "auto");
});
