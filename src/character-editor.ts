import { constants } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import {
  CharacterLoadError,
  isCharacterId,
  loadCharacter,
  parseCharacterCard,
  type Character,
} from "./character-loader.ts";

export class CharacterEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CharacterEditError";
  }
}

function isWithin(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return pathFromParent === "" || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== "..");
}

function normalizeForSave(markdown: string): string {
  return `${markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim()}\n`;
}

function assertValidCard(markdown: string, cardPath: string): string {
  try {
    parseCharacterCard(markdown, cardPath);
  } catch (error) {
    if (error instanceof CharacterLoadError) throw new CharacterEditError(error.message);
    throw error;
  }
  return normalizeForSave(markdown);
}

export function createCharacterTemplate(name: string): string {
  return `# ${name}

## Identity

描述角色是谁、来自何处、与用户的关系，以及对自身世界观的理解。

## Personality

描述核心性格、价值偏好、优点、缺点和敏感点。

## Speech Style

描述称呼、口癖、句式、语气、常用词、禁用词，并可加入示例对话。

## Behavior

描述角色如何表达赞同、质疑、关心、兴奋、失望和道歉，以及必须遵守的边界。

## Current Mood

Default: normal

### normal

保持角色的常态表达方式。
`;
}

async function ensureNewTarget(personalRoot: string, id: string): Promise<string> {
  if (!isCharacterId(id)) throw new CharacterEditError(`Invalid character id: ${id}`);
  await mkdir(personalRoot, { recursive: true });
  const canonicalRoot = await realpath(personalRoot);
  const target = join(canonicalRoot, id);
  try {
    await lstat(target);
    throw new CharacterEditError(`A personal character already exists: ${id}`);
  } catch (error) {
    if (error instanceof CharacterEditError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return target;
}

async function copyRegularTree(source: string, target: string): Promise<void> {
  await mkdir(target);
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isSymbolicLink()) throw new CharacterEditError(`Cannot copy symbolic link: ${sourcePath}`);
    if (entry.isDirectory()) {
      await copyRegularTree(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
    } else {
      throw new CharacterEditError(`Cannot copy non-regular file: ${sourcePath}`);
    }
  }
}

export async function createPersonalCharacter(
  personalRoot: string,
  id: string,
  markdown: string,
): Promise<Character> {
  const target = await ensureNewTarget(personalRoot, id);
  const normalized = assertValidCard(markdown, join(target, "CHARACTER.md"));
  const stagingRoot = await mkdtemp(join(await realpath(personalRoot), ".incarnate-create-"));
  try {
    const stagingCharacter = join(stagingRoot, id);
    await mkdir(stagingCharacter);
    await writeFile(join(stagingCharacter, "CHARACTER.md"), normalized, { encoding: "utf8", flag: "wx" });
    await loadCharacter(stagingRoot, id);
    await rename(stagingCharacter, target);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
  return await loadCharacter(personalRoot, id);
}

async function resolvePersonalDirectory(personalRoot: string, id: string): Promise<string> {
  if (!isCharacterId(id)) throw new CharacterEditError(`Invalid character id: ${id}`);
  const canonicalRoot = await realpath(personalRoot);
  const candidate = join(canonicalRoot, id);
  const info = await lstat(candidate).catch(() => undefined);
  if (!info?.isDirectory() || info.isSymbolicLink()) {
    throw new CharacterEditError(`Personal character directory is missing or invalid: ${id}`);
  }
  const canonicalDirectory = await realpath(candidate);
  if (!isWithin(canonicalRoot, canonicalDirectory) || dirname(canonicalDirectory) !== canonicalRoot) {
    throw new CharacterEditError(`Personal character directory escapes its root: ${id}`);
  }
  return canonicalDirectory;
}

export async function updatePersonalCharacter(
  personalRoot: string,
  id: string,
  markdown: string,
): Promise<Character> {
  const directory = await resolvePersonalDirectory(personalRoot, id);
  const cardPath = join(directory, "CHARACTER.md");
  const normalized = assertValidCard(markdown, cardPath);
  const temporaryPath = join(directory, `.CHARACTER.${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, normalized, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, cardPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return await loadCharacter(personalRoot, id);
}

export async function readPersonalCharacterDraft(personalRoot: string, id: string): Promise<string> {
  const directory = await resolvePersonalDirectory(personalRoot, id);
  const cardPath = join(directory, "CHARACTER.md");
  let buffer: Buffer;
  try {
    const cardInfo = await lstat(cardPath);
    if (!cardInfo.isFile() || cardInfo.isSymbolicLink()) {
      throw new CharacterEditError(`Personal CHARACTER.md must be a regular file: ${id}`);
    }
    buffer = await readFile(cardPath);
  } catch (error) {
    if (error instanceof CharacterEditError) throw error;
    throw new CharacterEditError(`Cannot read personal character card: ${id}`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new CharacterEditError(`CHARACTER.md is not valid UTF-8: ${cardPath}`);
  }
}

export async function createPersonalOverride(
  personalRoot: string,
  source: Character,
  markdown: string,
): Promise<Character> {
  const target = await ensureNewTarget(personalRoot, source.id);
  const normalized = assertValidCard(markdown, join(target, "CHARACTER.md"));
  const stagingRoot = await mkdtemp(join(await realpath(personalRoot), ".incarnate-copy-"));
  try {
    const stagingCharacter = join(stagingRoot, source.id);
    await copyRegularTree(source.directory, stagingCharacter);
    await writeFile(join(stagingCharacter, "CHARACTER.md"), normalized, "utf8");
    await loadCharacter(stagingRoot, source.id);
    await rename(stagingCharacter, target);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
  return await loadCharacter(personalRoot, source.id);
}

export async function readCharacterCard(character: Character): Promise<string> {
  return await readFile(character.cardPath, "utf8");
}

export function isPersonalCharacter(character: Character, personalRoot: string): boolean {
  return dirname(character.directory) === resolve(personalRoot);
}
