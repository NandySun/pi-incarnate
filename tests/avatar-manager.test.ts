import assert from "node:assert/strict";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import {
  installPersonalAvatar,
  prepareAvatarImport,
  removePersonalAvatars,
  resolveAvatarSourcePath,
} from "../src/avatar-manager.ts";
import { CharacterEditError } from "../src/character-editor.ts";

async function workspace(t: TestContext): Promise<{ root: string; personalRoot: string; characterDirectory: string }> {
  const root = join(tmpdir(), `pi-incarnate-avatar-manager-${crypto.randomUUID()}`);
  const personalRoot = join(root, "personal");
  const characterDirectory = join(personalRoot, "example");
  await mkdir(characterDirectory, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, personalRoot, characterDirectory };
}

test("resolves quoted, home-relative, file URL, and escaped avatar paths", () => {
  assert.equal(resolveAvatarSourcePath("'images/avatar.ansi'", "/workspace", "/users/example"), "/workspace/images/avatar.ansi");
  assert.equal(resolveAvatarSourcePath("~/avatar.txt", "/workspace", "/users/example"), "/users/example/avatar.txt");
  assert.equal(resolveAvatarSourcePath("images/avatar\\ file.txt", "/workspace", "/users/example"), "/workspace/images/avatar file.txt");
  assert.equal(resolveAvatarSourcePath("file:///tmp/avatar.ansi", "/workspace", "/users/example"), "/tmp/avatar.ansi");
});

test("imports a sanitized ANSI avatar and replaces the alternate format", async (t) => {
  const { root, personalRoot, characterDirectory } = await workspace(t);
  const source = join(root, "portrait.ansi");
  await writeFile(source, "\u001b[31mface\u001b[0m\u001b[2J\n");
  await writeFile(join(characterDirectory, "avatar.txt"), "old\n");

  const prepared = await prepareAvatarImport(source);
  const target = await installPersonalAvatar(personalRoot, "example", prepared);

  assert.equal(target, join(characterDirectory, "avatar.ansi"));
  assert.doesNotMatch(await readFile(target, "utf8"), /\u001b\[2J/);
  await assert.rejects(readFile(join(characterDirectory, "avatar.txt"), "utf8"));
  assert.deepEqual({ width: prepared.width, height: prepared.height }, { width: 4, height: 1 });
});

test("rejects lossy imports and symbolic-link sources", async (t) => {
  const { root } = await workspace(t);
  const tooWide = join(root, "wide.txt");
  const real = join(root, "real.txt");
  const linked = join(root, "linked.txt");
  await writeFile(tooWide, "x".repeat(49));
  await writeFile(real, "face\n");
  await symlink(real, linked);

  await assert.rejects(prepareAvatarImport(tooWide), CharacterEditError);
  await assert.rejects(prepareAvatarImport(linked), CharacterEditError);
});

test("removes both personal avatar formats", async (t) => {
  const { personalRoot, characterDirectory } = await workspace(t);
  await writeFile(join(characterDirectory, "avatar.ansi"), "ansi\n");
  await writeFile(join(characterDirectory, "avatar.txt"), "plain\n");

  assert.equal(await removePersonalAvatars(personalRoot, "example"), 2);
  assert.equal(await removePersonalAvatars(personalRoot, "example"), 0);
});
