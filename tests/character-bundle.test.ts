import assert from "node:assert/strict";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import {
  CHARACTER_BUNDLE_FORMAT,
  installCharacterBundle,
  prepareCharacterBundleImport,
  writeCharacterBundle,
} from "../src/character-bundle.ts";
import { CharacterEditError, createCharacterTemplate, createPersonalCharacter } from "../src/character-editor.ts";
import { loadCharacter } from "../src/character-loader.ts";

async function workspace(t: TestContext): Promise<string> {
  const root = join(tmpdir(), `pi-incarnate-bundle-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function card(name = "Example Character"): string {
  return createCharacterTemplate(name).replace(
    "## Current Mood",
    "## Tools and Forms\n\n- Notes: `./forms/notes.md`\n- Missing: `forms/missing.md`\n\n## Current Mood",
  );
}

function document(id: string, files: Array<{ path: string; content: string }>): string {
  return `${JSON.stringify({ format: CHARACTER_BUNDLE_FORMAT, version: 1, id, files }, null, 2)}\n`;
}

test("exports and imports the card, preferred avatar, and available declared forms", async (t) => {
  const root = await workspace(t);
  const sourceRoot = join(root, "source");
  const targetRoot = join(root, "target");
  await createPersonalCharacter(sourceRoot, "example", card());
  await mkdir(join(sourceRoot, "example", "forms"));
  await writeFile(join(sourceRoot, "example", "forms", "notes.md"), "# Notes\n\nPortable.\n");
  await writeFile(join(sourceRoot, "example", "avatar.txt"), "plain\n");
  await writeFile(join(sourceRoot, "example", "avatar.ansi"), "\u001b[31mface\u001b[0m\n");
  const character = await loadCharacter(sourceRoot, "example");
  const bundlePath = join(root, "example.pi-character.json");

  const summary = await writeCharacterBundle(character, bundlePath);
  const prepared = await prepareCharacterBundleImport(bundlePath);
  const imported = await installCharacterBundle(targetRoot, prepared);

  assert.deepEqual(summary, {
    id: "example",
    name: "Example Character",
    avatarIncluded: true,
    formsIncluded: 1,
    formsDeclared: 2,
  });
  assert.equal(imported.id, "example");
  assert.equal(imported.forms.filter((form) => form.status === "available").length, 1);
  assert.match(await readFile(join(targetRoot, "example", "avatar.ansi"), "utf8"), /\u001b\[31mface/);
  await assert.rejects(readFile(join(targetRoot, "example", "avatar.txt"), "utf8"));
  assert.equal(await readFile(join(targetRoot, "example", "forms", "notes.md"), "utf8"), "# Notes\n\nPortable.\n");
});

test("refuses to overwrite an export or an existing personal character", async (t) => {
  const root = await workspace(t);
  const sourceRoot = join(root, "source");
  const targetRoot = join(root, "target");
  const source = await createPersonalCharacter(sourceRoot, "example", card());
  const bundlePath = join(root, "example.pi-character.json");
  await writeCharacterBundle(source, bundlePath);
  await assert.rejects(writeCharacterBundle(source, bundlePath), CharacterEditError);

  const prepared = await prepareCharacterBundleImport(bundlePath);
  await createPersonalCharacter(targetRoot, "example", createCharacterTemplate("Existing"));
  await assert.rejects(installCharacterBundle(targetRoot, prepared), CharacterEditError);
  assert.equal((await loadCharacter(targetRoot, "example")).name, "Existing");
});

test("rejects symbolic-link bundle sources and unsupported suffixes", async (t) => {
  const root = await workspace(t);
  const realPath = join(root, "real.pi-character.json");
  const linkedPath = join(root, "linked.pi-character.json");
  await writeFile(realPath, document("example", [{ path: "CHARACTER.md", content: card() }]));
  await symlink(realPath, linkedPath);

  await assert.rejects(prepareCharacterBundleImport(linkedPath), CharacterEditError);
  await assert.rejects(prepareCharacterBundleImport(join(root, "bundle.json")), CharacterEditError);
});

test("rejects a symbolic-link export directory and malformed JSON", async (t) => {
  const root = await workspace(t);
  const source = await createPersonalCharacter(join(root, "source"), "example", card());
  const realDirectory = join(root, "exports");
  const linkedDirectory = join(root, "linked-exports");
  await mkdir(realDirectory);
  await symlink(realDirectory, linkedDirectory);

  await assert.rejects(
    writeCharacterBundle(source, join(linkedDirectory, "example.pi-character.json")),
    CharacterEditError,
  );
  const malformed = join(root, "malformed.pi-character.json");
  await writeFile(malformed, "{ definitely not JSON\n");
  await assert.rejects(prepareCharacterBundleImport(malformed), CharacterEditError);
});

test("rejects traversal, duplicate paths, undeclared files, and multiple avatars", async (t) => {
  const root = await workspace(t);
  const cases: Array<Array<{ path: string; content: string }>> = [
    [
      { path: "CHARACTER.md", content: card() },
      { path: "../outside.md", content: "outside" },
    ],
    [
      { path: "CHARACTER.md", content: card() },
      { path: "CHARACTER.md", content: card("Duplicate") },
    ],
    [
      { path: "CHARACTER.md", content: card() },
      { path: "forms/undeclared.md", content: "undeclared" },
    ],
    [
      { path: "CHARACTER.md", content: card() },
      { path: "avatar.ansi", content: "ansi" },
      { path: "avatar.txt", content: "plain" },
    ],
  ];

  for (const [index, files] of cases.entries()) {
    const path = join(root, `invalid-${index}.pi-character.json`);
    await writeFile(path, document("example", files));
    await assert.rejects(prepareCharacterBundleImport(path), CharacterEditError);
  }
});

test("revalidates a prepared bundle before installation", async (t) => {
  const root = await workspace(t);
  const bundlePath = join(root, "example.pi-character.json");
  await writeFile(bundlePath, document("example", [{ path: "CHARACTER.md", content: card() }]));
  const prepared = await prepareCharacterBundleImport(bundlePath);
  prepared.forms.push({ path: "../outside.md", content: "outside" });

  await assert.rejects(installCharacterBundle(join(root, "target"), prepared), CharacterEditError);
  await assert.rejects(loadCharacter(join(root, "target"), "example"));
});
