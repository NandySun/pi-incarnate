import assert from "node:assert/strict";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import {
  CharacterEditError,
  createCharacterTemplate,
  createPersonalCharacter,
  createPersonalOverride,
  readPersonalCharacterDraft,
  updatePersonalCharacter,
} from "../src/character-editor.ts";
import { loadCharacter } from "../src/character-loader.ts";

async function workspace(t: TestContext): Promise<{ builtInRoot: string; personalRoot: string }> {
  const root = join(tmpdir(), `pi-incarnate-editor-${crypto.randomUUID()}`);
  const builtInRoot = join(root, "built-in");
  const personalRoot = join(root, "personal");
  await mkdir(builtInRoot, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { builtInRoot, personalRoot };
}

test("creates a validated personal character from the editor template", async (t) => {
  const { personalRoot } = await workspace(t);

  const character = await createPersonalCharacter(personalRoot, "nova", createCharacterTemplate("Nova"));

  assert.equal(character.id, "nova");
  assert.equal(character.name, "Nova");
  assert.equal(character.mood.defaultPreset, "normal");
  assert.equal(await readFile(character.cardPath, "utf8"), createCharacterTemplate("Nova"));
});

test("invalid edits leave the existing card unchanged", async (t) => {
  const { personalRoot } = await workspace(t);
  const original = createCharacterTemplate("Nova");
  const character = await createPersonalCharacter(personalRoot, "nova", original);

  await assert.rejects(
    updatePersonalCharacter(personalRoot, "nova", "# Broken\n\n## Identity\nOnly one section."),
    CharacterEditError,
  );

  assert.equal(await readFile(character.cardPath, "utf8"), original);
});

test("reads and atomically repairs an invalid personal character draft", async (t) => {
  const { personalRoot } = await workspace(t);
  const directory = join(personalRoot, "broken");
  const invalid = "# Broken\n\n## Identity\nOnly one section.\n";
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "CHARACTER.md"), invalid);

  assert.equal(await readPersonalCharacterDraft(personalRoot, "broken"), invalid);
  const repaired = await updatePersonalCharacter(personalRoot, "broken", createCharacterTemplate("Repaired"));

  assert.equal(repaired.name, "Repaired");
  assert.equal(await readFile(repaired.cardPath, "utf8"), createCharacterTemplate("Repaired"));
});

test("editing a built-in character creates a personal override and preserves resources", async (t) => {
  const { builtInRoot, personalRoot } = await workspace(t);
  await mkdir(join(builtInRoot, "mira", "forms"), { recursive: true });
  const original = createCharacterTemplate("Mira").replace(
    "## Current Mood",
    "## Tools and Forms\n\n- Notes: `forms/notes.md`\n\n## Current Mood",
  );
  await writeFile(join(builtInRoot, "mira", "CHARACTER.md"), original);
  await writeFile(join(builtInRoot, "mira", "avatar.txt"), "(mira)\n");
  await writeFile(join(builtInRoot, "mira", "forms", "notes.md"), "# Notes\n");
  const builtIn = await loadCharacter(builtInRoot, "mira");
  const edited = original.replace("# Mira", "# My Mira");

  const personal = await createPersonalOverride(personalRoot, builtIn, edited);

  assert.equal(personal.name, "My Mira");
  assert.equal(personal.forms[0]?.status, "available");
  assert.equal(await readFile(join(personal.directory, "avatar.txt"), "utf8"), "(mira)\n");
});

test("copying a built-in character rejects symbolic-link resources", async (t) => {
  const { builtInRoot, personalRoot } = await workspace(t);
  await mkdir(join(builtInRoot, "mira"), { recursive: true });
  await writeFile(join(builtInRoot, "mira", "CHARACTER.md"), createCharacterTemplate("Mira"));
  await symlink("/tmp", join(builtInRoot, "mira", "linked"));
  const builtIn = await loadCharacter(builtInRoot, "mira");

  await assert.rejects(
    createPersonalOverride(personalRoot, builtIn, createCharacterTemplate("My Mira")),
    CharacterEditError,
  );

  await assert.rejects(readFile(join(personalRoot, "mira", "CHARACTER.md"), "utf8"));
});
