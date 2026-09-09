import assert from "node:assert/strict";
import { test } from "node:test";

import { MoodConfigError, composeMoodPrompt, parseMoodConfig } from "../src/mood.ts";

const CARD = `# Mira

## Current Mood
Default: warm

### warm
Respond with patient warmth.

### focused
Lead with the conclusion.
`;

test("parses default and named mood presets", () => {
  const mood = parseMoodConfig(CARD);
  assert.equal(mood.defaultPreset, "warm");
  assert.deepEqual([...mood.presets.keys()], ["warm", "focused"]);
  const prompt = composeMoodPrompt(mood, "focused") ?? "";
  assert.match(prompt, /Lead with the conclusion/);
  assert.match(prompt, /Only this named preset is active; do not blend in other preset definitions/);
  assert.match(prompt, /must visibly demonstrate this preset/);
  assert.match(prompt, /perceptible in wording, pacing, and response strategy without exaggerating/);
  assert.match(prompt, /does not override the character's identity, factual standards, or tool rules/);
});

test("rejects a default mood that is not declared", () => {
  assert.throws(
    () => parseMoodConfig(CARD.replace("Default: warm", "Default: missing")),
    (error: unknown) => error instanceof MoodConfigError && /does not match/.test(error.message),
  );
});

test("returns an empty config when Current Mood is absent", () => {
  const mood = parseMoodConfig("# Mira\n\n## Identity\nArchivist");
  assert.equal(mood.defaultPreset, undefined);
  assert.equal(mood.presets.size, 0);
});

test("requires Default before the first preset heading", () => {
  assert.throws(
    () => parseMoodConfig("## Current Mood\n### warm\nDefault: warm"),
    (error: unknown) => error instanceof MoodConfigError && /must declare/.test(error.message),
  );
});
