import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { visibleWidth } from "@earendil-works/pi-tui";

import {
  AVATAR_MAX_BYTES,
  AVATAR_MAX_COLUMNS,
  AVATAR_MAX_LINES,
  AVATAR_PNG_MAX_BYTES,
  sanitizeAnsiAvatar,
  sanitizeAvatar,
  validatePngAvatar,
  AvatarLoadError,
} from "./avatar.ts";
import { CharacterEditError, resolvePersonalDirectory } from "./character-editor.ts";

export type TextAvatarFileName = "avatar.ansi" | "avatar.txt";
export type AvatarFileName = "avatar.png" | TextAvatarFileName;

export interface PreparedTextAvatarImport {
  kind: "text";
  filename: TextAvatarFileName;
  content: string;
  width: number;
  height: number;
}

export interface PreparedPngAvatarImport {
  kind: "png";
  filename: "avatar.png";
  content: Buffer;
  width: number;
  height: number;
}

export type PreparedAvatarImport = PreparedTextAvatarImport | PreparedPngAvatarImport;

function stripWrappingQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  return (first === "'" || first === '"') && value.at(-1) === first ? value.slice(1, -1) : value;
}

export function resolveUserPath(input: string, cwd: string, userHome = homedir()): string {
  let value = stripWrappingQuotes(input.trim()).replace(/\\([\\ ])/g, "$1");
  if (value.startsWith("file://")) return fileURLToPath(value);
  if (value === "~") value = userHome;
  else if (value.startsWith("~/")) value = join(userHome, value.slice(2));
  return resolve(cwd, value);
}

export function resolveAvatarSourcePath(input: string, cwd: string, userHome = homedir()): string {
  return resolveUserPath(input, cwd, userHome);
}

export function prepareAvatarContent(filename: TextAvatarFileName, raw: string): PreparedTextAvatarImport {
  if (Buffer.byteLength(raw, "utf8") > AVATAR_MAX_BYTES) {
    throw new CharacterEditError(`Avatar exceeds the ${AVATAR_MAX_BYTES}-byte limit`);
  }
  const avatar = filename === "avatar.ansi" ? sanitizeAnsiAvatar(raw) : sanitizeAvatar(raw);
  if (avatar.lines.length === 0) throw new CharacterEditError("Avatar contains no visible content");
  if (avatar.truncated) {
    throw new CharacterEditError(`Avatar must fit within ${AVATAR_MAX_COLUMNS} columns and ${AVATAR_MAX_LINES} lines`);
  }
  return {
    kind: "text",
    filename,
    content: `${avatar.lines.join("\n")}\n`,
    width: avatar.lines.reduce((maximum, line) => Math.max(maximum, visibleWidth(line)), 0),
    height: avatar.lines.length,
  };
}

export function preparePngAvatarContent(bytes: Uint8Array): PreparedPngAvatarImport {
  try {
    const image = validatePngAvatar(bytes);
    return {
      kind: "png",
      filename: "avatar.png",
      content: Buffer.from(bytes),
      width: image.widthPx,
      height: image.heightPx,
    };
  } catch (error) {
    if (error instanceof AvatarLoadError) throw new CharacterEditError(error.message);
    throw error;
  }
}

export async function prepareAvatarImport(sourcePath: string): Promise<PreparedAvatarImport> {
  const extension = extname(sourcePath).toLowerCase();
  let filename: AvatarFileName;
  let maximumBytes: number;
  if (extension === ".ansi") filename = "avatar.ansi";
  else if (extension === ".txt") filename = "avatar.txt";
  else if (extension === ".png") filename = "avatar.png";
  else throw new CharacterEditError("Avatar file must end in .png, .ansi, or .txt");
  maximumBytes = filename === "avatar.png" ? AVATAR_PNG_MAX_BYTES : AVATAR_MAX_BYTES;

  let bytes: Buffer;
  try {
    const info = await lstat(sourcePath);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new CharacterEditError(`Avatar source must be a regular file: ${sourcePath}`);
    }
    if (info.size > maximumBytes) {
      throw new CharacterEditError(`Avatar exceeds the ${maximumBytes}-byte limit: ${sourcePath}`);
    }
    bytes = await readFile(sourcePath);
    if (bytes.byteLength > maximumBytes) {
      throw new CharacterEditError(`Avatar exceeds the ${maximumBytes}-byte limit: ${sourcePath}`);
    }
  } catch (error) {
    if (error instanceof CharacterEditError) throw error;
    throw new CharacterEditError(`Cannot read avatar source: ${sourcePath}`);
  }

  if (filename === "avatar.png") return preparePngAvatarContent(bytes);

  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CharacterEditError(`Avatar source is not valid UTF-8: ${sourcePath}`);
  }
  return prepareAvatarContent(filename, raw);
}

async function assertReplaceable(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isDirectory()) throw new CharacterEditError(`Avatar target is a directory: ${path}`);
  } catch (error) {
    if (error instanceof CharacterEditError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function installPersonalAvatar(
  personalRoot: string,
  id: string,
  prepared: PreparedAvatarImport,
): Promise<string> {
  const directory = await resolvePersonalDirectory(personalRoot, id);
  const targetPath = join(directory, prepared.filename);
  const alternatePath = prepared.kind === "text"
    ? join(directory, prepared.filename === "avatar.ansi" ? "avatar.txt" : "avatar.ansi")
    : undefined;
  await assertReplaceable(targetPath);
  if (alternatePath) await assertReplaceable(alternatePath);

  const nonce = crypto.randomUUID();
  const temporaryPath = join(directory, `.avatar-import-${nonce}.tmp`);
  const alternateBackup = join(directory, `.avatar-replaced-${nonce}.tmp`);
  let movedAlternate = false;
  try {
    if (prepared.kind === "png") await writeFile(temporaryPath, prepared.content, { flag: "wx" });
    else await writeFile(temporaryPath, prepared.content, { encoding: "utf8", flag: "wx" });
    if (alternatePath) {
      try {
        await rename(alternatePath, alternateBackup);
        movedAlternate = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await rename(temporaryPath, targetPath);
    if (movedAlternate) await rm(alternateBackup, { force: true });
  } catch (error) {
    if (movedAlternate && alternatePath) await rename(alternateBackup, alternatePath).catch(() => undefined);
    throw new CharacterEditError(`Cannot install avatar for ${id}: ${error instanceof Error ? error.message : "unknown error"}`);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return targetPath;
}

export async function removePersonalAvatars(personalRoot: string, id: string): Promise<number> {
  const directory = await resolvePersonalDirectory(personalRoot, id);
  let removed = 0;
  for (const filename of ["avatar.png", "avatar.ansi", "avatar.txt"] as const) {
    const path = join(directory, filename);
    try {
      const info = await lstat(path);
      if (info.isDirectory()) throw new CharacterEditError(`Avatar target is a directory: ${path}`);
      await rm(path);
      removed += 1;
    } catch (error) {
      if (error instanceof CharacterEditError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new CharacterEditError(`Cannot remove avatar: ${path}`);
      }
    }
  }
  return removed;
}
