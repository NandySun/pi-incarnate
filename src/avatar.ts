import { readFile, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { Character } from "./character-loader.ts";

export const AVATAR_MAX_COLUMNS = 48;
export const AVATAR_MAX_LINES = 16;
export const AVATAR_MAX_BYTES = 64 * 1024;
const ANSI_RESET = "\u001b[0m";
const CSI_SEQUENCE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export interface Avatar {
  lines: string[];
  truncated: boolean;
}

export class AvatarLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvatarLoadError";
  }
}

function isSafeSgr(sequence: string): boolean {
  const match = sequence.match(/^\u001b\[([0-9;]*)m$/);
  if (!match) return false;
  const parameters = match[1] === "" ? [0] : match[1].split(";").map(Number);
  if (parameters.some((value) => !Number.isInteger(value))) return false;
  if (parameters.length === 1) {
    const value = parameters[0]!;
    return (
      value === 0 ||
      value === 39 ||
      value === 49 ||
      (value >= 30 && value <= 37) ||
      (value >= 40 && value <= 47) ||
      (value >= 90 && value <= 97) ||
      (value >= 100 && value <= 107)
    );
  }
  if (parameters.length === 3 && (parameters[0] === 38 || parameters[0] === 48) && parameters[1] === 5) {
    return parameters[2]! >= 0 && parameters[2]! <= 255;
  }
  if (parameters.length === 5 && (parameters[0] === 38 || parameters[0] === 48) && parameters[1] === 2) {
    return parameters.slice(2).every((value) => value >= 0 && value <= 255);
  }
  return false;
}

function preserveSafeSgr(raw: string): string {
  const sequences: string[] = [];
  const tokenized = raw
    .replace(/[\uE000\uE001]/g, "")
    .replace(CSI_SEQUENCE_PATTERN, (sequence) => {
      if (!isSafeSgr(sequence)) return "";
      const index = sequences.push(sequence) - 1;
      return `\uE000${index}\uE001`;
    });
  return stripTerminalSequences(tokenized)
    .replace(CONTROL_CHARACTER_PATTERN, "")
    .replace(/\uE000(\d+)\uE001/g, (_token, index: string) => sequences[Number(index)] ?? "");
}

function isVisuallyBlank(line: string): boolean {
  return stripTerminalSequences(line).trim() === "";
}

function limitAvatarLines(lines: string[], maxColumns: number, maxLines: number): Avatar {
  let truncated = false;
  const limited = lines.map((line) => {
    if (visibleWidth(line) <= maxColumns) return line;
    truncated = true;
    return truncateToWidth(line, maxColumns, "…");
  });
  while (limited.length > 0 && isVisuallyBlank(limited[0]!)) limited.shift();
  while (limited.length > 0 && isVisuallyBlank(limited.at(-1)!)) limited.pop();
  if (limited.length > maxLines) {
    limited.splice(maxLines);
    truncated = true;
  }
  return { lines: limited, truncated };
}

function isWithin(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`);
}

export function sanitizeAvatar(raw: string, maxColumns = AVATAR_MAX_COLUMNS, maxLines = AVATAR_MAX_LINES): Avatar {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n").map((line) => {
    const safe = stripTerminalSequences(line.replace(/\t/g, "    "))
      .replace(CONTROL_CHARACTER_PATTERN, "")
      .trimEnd();
    return safe;
  });
  return limitAvatarLines(lines, maxColumns, maxLines);
}

export function sanitizeAnsiAvatar(
  raw: string,
  maxColumns = AVATAR_MAX_COLUMNS,
  maxLines = AVATAR_MAX_LINES,
): Avatar {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n").map((line) => {
    const safe = preserveSafeSgr(line.replace(/\t/g, "    "));
    return safe.includes("\u001b[") ? `${safe}${ANSI_RESET}` : safe;
  });
  return limitAvatarLines(lines, maxColumns, maxLines);
}

async function loadAvatarFile(character: Character, filename: string, allowAnsi: boolean): Promise<Avatar | undefined> {
  const avatarPath = join(character.directory, filename);
  let canonicalAvatarPath: string;
  try {
    canonicalAvatarPath = await realpath(avatarPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new AvatarLoadError(`Cannot inspect avatar: ${avatarPath}`);
  }
  if (!isWithin(character.directory, canonicalAvatarPath)) {
    throw new AvatarLoadError(`Avatar path escapes the character directory: ${avatarPath}`);
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(canonicalAvatarPath);
  } catch {
    throw new AvatarLoadError(`Cannot read avatar: ${avatarPath}`);
  }
  if (bytes.byteLength > AVATAR_MAX_BYTES) {
    throw new AvatarLoadError(`${filename} exceeds the ${AVATAR_MAX_BYTES}-byte limit: ${avatarPath}`);
  }

  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AvatarLoadError(`${filename} is not valid UTF-8: ${avatarPath}`);
  }
  return allowAnsi ? sanitizeAnsiAvatar(raw) : sanitizeAvatar(raw);
}

export async function loadAvatar(character: Character): Promise<Avatar | undefined> {
  const ansi = await loadAvatarFile(character, "avatar.ansi", true);
  if (ansi) return ansi;
  return await loadAvatarFile(character, "avatar.txt", false);
}
