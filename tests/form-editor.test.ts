import assert from "node:assert/strict";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { CharacterEditError } from "../src/character-editor.ts";
import { readFormDraft, savePersonalForm } from "../src/form-editor.ts";

async function workspace(t: TestContext): Promise<{ root: string; personalRoot: string; characterDirectory: string }> {
  const root = join(tmpdir(), `pi-incarnate-form-editor-${crypto.randomUUID()}`);
  const personalRoot = join(root, "personal");
  const characterDirectory = join(personalRoot, "example");
  await mkdir(characterDirectory, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, personalRoot, characterDirectory };
}

test("creates a missing nested Markdown form from its draft template", async (t) => {
  const { personalRoot, characterDirectory } = await workspace(t);
  const draft = await readFormDraft(characterDirectory, "forms/preferences.md", "Preferences");

  assert.equal(draft.exists, false);
  assert.match(draft.content, /^# Preferences/);
  const target = await savePersonalForm(personalRoot, "example", "forms/preferences.md", draft.content);

  assert.equal(target, join(characterDirectory, "forms", "preferences.md"));
  assert.equal(await readFile(target, "utf8"), draft.content);
});

test("reads and atomically updates an existing UTF-8 form", async (t) => {
  const { personalRoot, characterDirectory } = await workspace(t);
  await mkdir(join(characterDirectory, "forms"));
  await writeFile(join(characterDirectory, "forms", "notes.md"), "# Notes\r\n\r\nOld\r\n");

  const draft = await readFormDraft(characterDirectory, "forms/notes.md", "Notes");
  assert.equal(draft.exists, true);
  await savePersonalForm(personalRoot, "example", "forms/notes.md", "# Notes\r\n\r\nNew");

  assert.equal(await readFile(draft.path, "utf8"), "# Notes\n\nNew\n");
});

test("rejects traversal, non-Markdown files, and symbolic-link targets", async (t) => {
  const { root, personalRoot, characterDirectory } = await workspace(t);
  const external = join(root, "external.md");
  await writeFile(external, "external");
  await symlink(external, join(characterDirectory, "linked.md"));

  await assert.rejects(readFormDraft(characterDirectory, "../outside.md", "Outside"), CharacterEditError);
  await assert.rejects(readFormDraft(characterDirectory, "forms/data.bin", "Data"), CharacterEditError);
  await assert.rejects(savePersonalForm(personalRoot, "example", "linked.md", "replacement"), CharacterEditError);
  assert.equal(await readFile(external, "utf8"), "external");
});
