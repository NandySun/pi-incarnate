import assert from "node:assert/strict";
import { mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";

import {
  archivePersonalCharacter,
  discoverArchivedCharacters,
  renamePersonalCharacter,
  restoreArchivedCharacter,
} from "../src/character-lifecycle.ts";
import { CharacterEditError, createCharacterTemplate, createPersonalCharacter } from "../src/character-editor.ts";

function personalRoot(t: TestContext): string {
  const root = join(tmpdir(), `pi-incarnate-lifecycle-${crypto.randomUUID()}`, "characters");
  t.after(() => rm(dirname(root), { recursive: true, force: true }));
  return root;
}

test("renames a personal character directory without changing its display name", async (t) => {
  const root = personalRoot(t);
  await createPersonalCharacter(root, "example", createCharacterTemplate("Example Character"));

  const renamed = await renamePersonalCharacter(root, "example", "renamed-example");

  assert.equal(renamed.id, "renamed-example");
  assert.equal(renamed.name, "Example Character");
  await assert.rejects(renamePersonalCharacter(root, "renamed-example", "Bad Name"), CharacterEditError);
});

test("archives and restores a personal character without deleting its resources", async (t) => {
  const root = personalRoot(t);
  await createPersonalCharacter(root, "example", createCharacterTemplate("Example Character"));

  const archivedPath = await archivePersonalCharacter(root, "example");
  const archived = await discoverArchivedCharacters(root);

  assert.equal(archived.characters[0]?.directory, archivedPath);
  const restored = await restoreArchivedCharacter(root, "example");
  assert.equal(restored.id, "example");
  assert.equal((await discoverArchivedCharacters(root)).characters.length, 0);
});

test("refuses archive and restore collisions", async (t) => {
  const root = personalRoot(t);
  await createPersonalCharacter(root, "example", createCharacterTemplate("Example Character"));
  await archivePersonalCharacter(root, "example");
  await createPersonalCharacter(root, "example", createCharacterTemplate("Replacement"));

  await assert.rejects(restoreArchivedCharacter(root, "example"), CharacterEditError);
  await assert.rejects(archivePersonalCharacter(root, "example"), CharacterEditError);
});

test("refuses a symbolic-link archive root", async (t) => {
  const root = personalRoot(t);
  const outside = join(tmpdir(), `pi-incarnate-lifecycle-outside-${crypto.randomUUID()}`);
  t.after(() => rm(outside, { recursive: true, force: true }));
  await createPersonalCharacter(root, "example", createCharacterTemplate("Example Character"));
  await mkdir(outside, { recursive: true });
  await symlink(outside, join(dirname(root), "archive"));

  await assert.rejects(archivePersonalCharacter(root, "example"), CharacterEditError);
  await assert.rejects(discoverArchivedCharacters(root), CharacterEditError);
});
