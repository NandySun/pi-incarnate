import assert from "node:assert/strict";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { CharacterLoadError, discoverCharacters, loadCharacter } from "../src/character-loader.ts";

const VALID_CARD = `# Mira

## Identity
An observant archivist.

## Personality
Warm, curious, and candid.

## Speech Style
Concise sentences and gentle questions.

## Behavior
States uncertainty and never invents observations.
`;

async function makeCharactersRoot(t: TestContext): Promise<string> {
  const root = join(tmpdir(), `pi-incarnate-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("loads a valid UTF-8 character card", async (t) => {
  const root = await makeCharactersRoot(t);
  await mkdir(join(root, "mira"));
  await writeFile(join(root, "mira", "CHARACTER.md"), VALID_CARD);

  const character = await loadCharacter(root, "mira");

  assert.equal(character.id, "mira");
  assert.equal(character.name, "Mira");
  assert.equal(character.sections.Identity, "An observant archivist.");
});

test("reports missing required sections", async (t) => {
  const root = await makeCharactersRoot(t);
  await mkdir(join(root, "incomplete"));
  await writeFile(join(root, "incomplete", "CHARACTER.md"), "# Incomplete\n\n## Identity\nUnknown\n");

  await assert.rejects(
    loadCharacter(root, "incomplete"),
    (error: unknown) => error instanceof CharacterLoadError && error.code === "invalid-card",
  );
});

test("rejects invalid UTF-8", async (t) => {
  const root = await makeCharactersRoot(t);
  await mkdir(join(root, "binary"));
  await writeFile(join(root, "binary", "CHARACTER.md"), Buffer.from([0xc3, 0x28]));

  await assert.rejects(
    loadCharacter(root, "binary"),
    (error: unknown) => error instanceof CharacterLoadError && error.code === "invalid-encoding",
  );
});

test("discovery sorts valid cards and reports invalid directories", async (t) => {
  const root = await makeCharactersRoot(t);
  for (const id of ["zeta", "alpha", "Bad Name"]) {
    await mkdir(join(root, id));
    await writeFile(join(root, id, "CHARACTER.md"), VALID_CARD.replace("Mira", id));
  }

  const result = await discoverCharacters(root);

  assert.deepEqual(result.characters.map((character) => character.id), ["alpha", "zeta"]);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, "invalid-directory");
});

test("rejects traversal ids", async (t) => {
  const root = await makeCharactersRoot(t);
  await assert.rejects(
    loadCharacter(root, "../outside"),
    (error: unknown) => error instanceof CharacterLoadError && error.code === "invalid-directory",
  );
});

test("ignores heading-like text inside fenced code blocks", async (t) => {
  const root = await makeCharactersRoot(t);
  await mkdir(join(root, "mira"));
  await writeFile(
    join(root, "mira", "CHARACTER.md"),
    VALID_CARD.replace(
      "Concise sentences and gentle questions.",
      "Concise sentences.\n\n```markdown\n## Behavior\nThis is only an example.\n```",
    ),
  );

  const character = await loadCharacter(root, "mira");

  assert.match(character.sections["Speech Style"], /This is only an example/);
  assert.equal(character.sections.Behavior, "States uncertainty and never invents observations.");
});

test("rejects symbolic-link character directories", async (t) => {
  const root = await makeCharactersRoot(t);
  const realCharacter = join(tmpdir(), `pi-incarnate-linked-${crypto.randomUUID()}`);
  await mkdir(realCharacter);
  await writeFile(join(realCharacter, "CHARACTER.md"), VALID_CARD);
  await symlink(realCharacter, join(root, "linked"));
  t.after(() => rm(realCharacter, { recursive: true, force: true }));

  const discovery = await discoverCharacters(root);

  assert.equal(discovery.characters.length, 0);
  assert.equal(discovery.issues[0].code, "invalid-directory");
  await assert.rejects(
    loadCharacter(root, "linked"),
    (error: unknown) => error instanceof CharacterLoadError && error.code === "invalid-directory",
  );
});

test("rejects symbolic-link character cards before reading them", async (t) => {
  const root = await makeCharactersRoot(t);
  const external = join(tmpdir(), `pi-incarnate-external-${crypto.randomUUID()}.md`);
  await writeFile(external, VALID_CARD);
  t.after(() => rm(external, { force: true }));
  await mkdir(join(root, "linked-card"));
  await symlink(external, join(root, "linked-card", "CHARACTER.md"));

  await assert.rejects(
    loadCharacter(root, "linked-card"),
    (error: unknown) => error instanceof CharacterLoadError && error.code === "outside-root",
  );
});
