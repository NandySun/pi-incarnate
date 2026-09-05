import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { discoverCharacterCatalog, loadCatalogCharacter } from "../src/character-catalog.ts";

function card(name: string): string {
  return `# ${name}\n\n## Identity\nIdentity.\n\n## Personality\nPersonality.\n\n## Speech Style\nStyle.\n\n## Behavior\nBehavior.\n`;
}

async function roots(t: TestContext): Promise<{ builtInRoot: string; personalRoot: string }> {
  const root = join(tmpdir(), `pi-incarnate-catalog-${crypto.randomUUID()}`);
  const builtInRoot = join(root, "built-in");
  const personalRoot = join(root, "personal");
  await mkdir(builtInRoot, { recursive: true });
  await mkdir(personalRoot, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { builtInRoot, personalRoot };
}

async function writeCharacter(root: string, id: string, name: string): Promise<void> {
  await mkdir(join(root, id));
  await writeFile(join(root, id, "CHARACTER.md"), card(name));
}

test("personal characters override built-in characters with the same id", async (t) => {
  const locations = await roots(t);
  await writeCharacter(locations.builtInRoot, "mira", "Built-in Mira");
  await writeCharacter(locations.builtInRoot, "sol", "Sol");
  await writeCharacter(locations.personalRoot, "mira", "Personal Mira");

  const catalog = await discoverCharacterCatalog(locations);
  const loaded = await loadCatalogCharacter(locations, "mira");

  assert.deepEqual(catalog.entries.map(({ character }) => character.id), ["mira", "sol"]);
  assert.equal(catalog.entries[0]?.source, "personal");
  assert.equal(catalog.entries[0]?.character.name, "Personal Mira");
  assert.equal(loaded.source, "personal");
  assert.equal(loaded.character.name, "Personal Mira");
});

test("a missing personal root does not hide built-in characters", async (t) => {
  const locations = await roots(t);
  await rm(locations.personalRoot, { recursive: true });
  await writeCharacter(locations.builtInRoot, "mira", "Mira");

  const catalog = await discoverCharacterCatalog(locations);

  assert.equal(catalog.entries.length, 1);
  assert.equal(catalog.entries[0]?.source, "built-in");
});
