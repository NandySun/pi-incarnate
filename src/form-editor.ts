import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

import { CharacterEditError, resolvePersonalDirectory } from "./character-editor.ts";

export const FORM_MAX_BYTES = 256 * 1024;

export interface FormDraft {
  path: string;
  content: string;
  exists: boolean;
}

function isWithin(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent);
}

function formTarget(characterDirectory: string, declaredPath: string): string {
  if (!declaredPath || isAbsolute(declaredPath) || extname(declaredPath).toLowerCase() !== ".md") {
    throw new CharacterEditError("Editable form paths must be relative .md files");
  }
  const target = resolve(characterDirectory, declaredPath);
  if (!isWithin(characterDirectory, target) || target === characterDirectory) {
    throw new CharacterEditError(`Form path escapes the character directory: ${declaredPath}`);
  }
  return target;
}

function formTemplate(label: string): string {
  return `# ${label}\n\n在这里记录希望角色按需读取的偏好信息。\n`;
}

async function inspectExistingForm(characterDirectory: string, target: string): Promise<Buffer | undefined> {
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new CharacterEditError(`Cannot inspect form file: ${target}`);
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new CharacterEditError(`Form must be a regular file, not a symbolic link: ${target}`);
  }
  const canonicalTarget = await realpath(target);
  if (!isWithin(characterDirectory, canonicalTarget)) {
    throw new CharacterEditError(`Form path escapes the character directory: ${target}`);
  }
  if (info.size > FORM_MAX_BYTES) throw new CharacterEditError(`Form exceeds the ${FORM_MAX_BYTES}-byte editor limit: ${target}`);
  const bytes = await readFile(canonicalTarget);
  if (bytes.byteLength > FORM_MAX_BYTES) throw new CharacterEditError(`Form exceeds the ${FORM_MAX_BYTES}-byte editor limit: ${target}`);
  return bytes;
}

export async function readFormDraft(
  characterDirectory: string,
  declaredPath: string,
  label: string,
): Promise<FormDraft> {
  const canonicalDirectory = await realpath(characterDirectory);
  const target = formTarget(canonicalDirectory, declaredPath);
  const bytes = await inspectExistingForm(canonicalDirectory, target);
  if (!bytes) return { path: target, content: formTemplate(label), exists: false };
  try {
    return { path: target, content: new TextDecoder("utf-8", { fatal: true }).decode(bytes), exists: true };
  } catch {
    throw new CharacterEditError(`Form is not valid UTF-8: ${target}`);
  }
}

async function ensureSafeParent(characterDirectory: string, target: string): Promise<string> {
  const relativeParent = relative(characterDirectory, dirname(target));
  let current = characterDirectory;
  for (const segment of relativeParent.split(sep).filter((value) => value && value !== ".")) {
    current = resolve(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new CharacterEditError(`Form parent must be a regular directory: ${current}`);
    }
    const canonicalCurrent = await realpath(current);
    if (!isWithin(characterDirectory, canonicalCurrent)) {
      throw new CharacterEditError(`Form parent escapes the character directory: ${current}`);
    }
  }
  return current;
}

export async function savePersonalForm(
  personalRoot: string,
  id: string,
  declaredPath: string,
  content: string,
): Promise<string> {
  const characterDirectory = await resolvePersonalDirectory(personalRoot, id);
  const target = formTarget(characterDirectory, declaredPath);
  await inspectExistingForm(characterDirectory, target);
  const parent = await ensureSafeParent(characterDirectory, target);
  const normalized = `${content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trimEnd()}\n`;
  if (Buffer.byteLength(normalized, "utf8") > FORM_MAX_BYTES) {
    throw new CharacterEditError(`Form exceeds the ${FORM_MAX_BYTES}-byte editor limit: ${target}`);
  }
  const temporaryPath = resolve(parent, `.form-${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, normalized, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, target);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return target;
}
