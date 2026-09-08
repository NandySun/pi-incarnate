import assert from "node:assert/strict";
import { test } from "node:test";

import {
  readCharacterSection,
  sectionStarter,
  updateCharacterName,
  updateCharacterSection,
} from "../src/character-section-editor.ts";
import { createCharacterTemplate } from "../src/character-editor.ts";
import { parseCharacterCard } from "../src/character-loader.ts";

test("updates one section while preserving custom sections and fenced headings", () => {
  const original = createCharacterTemplate("Example").replace(
    "## Personality",
    "## Custom Notes\n\n```md\n## Identity\ninside fence\n```\n\n## Personality",
  );

  const updated = updateCharacterSection(original, "Identity", "A rewritten identity.\n\nWith context.");

  assert.equal(readCharacterSection(updated, "Identity").content, "A rewritten identity.\n\nWith context.");
  assert.match(updated, /## Custom Notes\n\n```md\n## Identity\ninside fence\n```/);
  assert.equal(parseCharacterCard(updated).name, "Example");
});

test("creates missing optional sections from guided starters", () => {
  const original = createCharacterTemplate("Example").replace(/\n## Current Mood[\s\S]*$/, "\n");
  const withMood = updateCharacterSection(original, "Current Mood", sectionStarter("Current Mood"));
  const withForms = updateCharacterSection(withMood, "Tools and Forms", sectionStarter("Tools and Forms"));

  assert.equal(parseCharacterCard(withForms).mood.defaultPreset, "normal");
  assert.equal(readCharacterSection(withForms, "Tools and Forms").exists, true);
  assert.match(withForms, /forms\/preferences\.md/);
});

test("updates the first level-one name without changing the remaining card", () => {
  const original = createCharacterTemplate("Example");
  const updated = updateCharacterName(original, " 新名字 ");

  assert.equal(parseCharacterCard(updated).name, "新名字");
  assert.equal(updated.replace("# 新名字", "# Example"), original);
  assert.throws(() => updateCharacterName(original, "Ambiguous ###"), /closing hashes/);
});

test("refuses ambiguous duplicate sections", () => {
  const duplicate = `${createCharacterTemplate("Example")}\n## Identity\n\nDuplicate.\n`;
  assert.throws(() => readCharacterSection(duplicate, "Identity"), /duplicate sections/);
  assert.throws(() => updateCharacterSection(duplicate, "Identity", "Changed"), /duplicate sections/);
  assert.throws(
    () => updateCharacterSection(createCharacterTemplate("Example"), "Identity", "Changed\n\n## Injected"),
    /cannot contain level-one or level-two headings/,
  );
});
