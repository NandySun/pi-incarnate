import { lstat, mkdir, realpath, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { CharacterEditError, resolvePersonalDirectory } from "./character-editor.ts";
import { discoverCharacters, isCharacterId, loadCharacter, type CharacterDiscovery, type Character } from "./character-loader.ts";

export function characterArchiveRoot(personalRoot: string): string {
  return join(dirname(resolve(personalRoot)), "archive");
}

async function ensureRealRoot(root: string): Promise<string> {
  await mkdir(root, { recursive: true });
  const canonicalRoot = await resolveExistingRoot(root);
  if (!canonicalRoot) throw new CharacterEditError(`Character root disappeared: ${root}`);
  return canonicalRoot;
}

async function resolveExistingRoot(root: string): Promise<string | undefined> {
  let info;
  try {
    info = await lstat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new CharacterEditError(`Character root must be a real directory: ${root}`);
  }
  return await realpath(root);
}

async function assertMissing(path: string, message: string): Promise<void> {
  try {
    await lstat(path);
    throw new CharacterEditError(message);
  } catch (error) {
    if (error instanceof CharacterEditError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function renamePersonalCharacter(
  personalRoot: string,
  currentId: string,
  nextId: string,
): Promise<Character> {
  if (!isCharacterId(nextId)) throw new CharacterEditError(`Invalid character id: ${nextId}`);
  if (currentId === nextId) throw new CharacterEditError("The new character id is unchanged");
  const source = await resolvePersonalDirectory(personalRoot, currentId);
  const canonicalRoot = await realpath(personalRoot);
  const target = join(canonicalRoot, nextId);
  await assertMissing(target, `A personal character already exists: ${nextId}`);

  await rename(source, target);
  try {
    return await loadCharacter(canonicalRoot, nextId);
  } catch (error) {
    await rename(target, source).catch(() => undefined);
    throw new CharacterEditError(`Cannot rename character: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

export async function archivePersonalCharacter(personalRoot: string, id: string): Promise<string> {
  const source = await resolvePersonalDirectory(personalRoot, id);
  await loadCharacter(personalRoot, id);
  const archiveRoot = await ensureRealRoot(characterArchiveRoot(personalRoot));
  const target = join(archiveRoot, id);
  await assertMissing(target, `An archived character already exists: ${id}`);
  await rename(source, target);
  return target;
}

export async function discoverArchivedCharacters(personalRoot: string): Promise<CharacterDiscovery> {
  const archiveRoot = await resolveExistingRoot(characterArchiveRoot(personalRoot));
  return archiveRoot ? await discoverCharacters(archiveRoot) : { characters: [], issues: [] };
}

export async function restoreArchivedCharacter(personalRoot: string, id: string): Promise<Character> {
  if (!isCharacterId(id)) throw new CharacterEditError(`Invalid character id: ${id}`);
  const archiveRoot = await ensureRealRoot(characterArchiveRoot(personalRoot));
  const archived = await loadCharacter(archiveRoot, id);
  await mkdir(personalRoot, { recursive: true });
  const canonicalPersonalRoot = await realpath(personalRoot);
  const target = join(canonicalPersonalRoot, id);
  await assertMissing(target, `A personal character already exists: ${id}`);

  await rename(archived.directory, target);
  try {
    return await loadCharacter(canonicalPersonalRoot, id);
  } catch (error) {
    await rename(target, archived.directory).catch(() => undefined);
    throw new CharacterEditError(`Cannot restore character: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}
