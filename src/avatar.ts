import { readFile, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { Character } from "./character-loader.ts";

export const AVATAR_MAX_COLUMNS = 48;
export const AVATAR_MAX_LINES = 12;

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

function isWithin(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`);
}

export function sanitizeAvatar(raw: string, maxColumns = AVATAR_MAX_COLUMNS, maxLines = AVATAR_MAX_LINES): Avatar {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  let truncated = false;
  let lines = normalized.split("\n").map((line) => {
    const safe = stripTerminalSequences(line.replace(/\t/g, "    "))
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .trimEnd();
    if (visibleWidth(safe) <= maxColumns) return safe;
    truncated = true;
    return truncateToWidth(safe, maxColumns, "…");
  });
  while (lines[0] === "") lines.shift();
  while (lines.at(-1) === "") lines.pop();
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    truncated = true;
  }
  return { lines, truncated };
}

export async function loadAvatar(character: Character): Promise<Avatar | undefined> {
  const avatarPath = join(character.directory, "avatar.txt");
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

  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AvatarLoadError(`avatar.txt is not valid UTF-8: ${avatarPath}`);
  }
  return sanitizeAvatar(raw);
}

export function renderAvatarWidget(character: Character, mood: string | undefined, avatar: Avatar | undefined): string[] {
  const moodLabel = mood ? ` · mood: ${mood}` : "";
  const header = truncateToWidth(`pi-incarnate · ${character.name}${moodLabel}`, AVATAR_MAX_COLUMNS, "…");
  return [header, ...(avatar?.lines ?? [])];
}
