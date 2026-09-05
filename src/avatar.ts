import { readFile, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";

import type { Character } from "./character-loader.ts";
import type { AvatarMode } from "./session-state.ts";

export const AVATAR_MAX_COLUMNS = 48;
export const AVATAR_MAX_LINES = 12;
export const AUTO_FULL_MIN_COLUMNS = 72;

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

function rightAlign(line: string, width: number): string {
  const safe = truncateToWidth(line, width, "");
  return `${" ".repeat(Math.max(0, width - visibleWidth(safe)))}${safe}`;
}

export function resolveAvatarMode(
  requestedMode: Exclude<AvatarMode, "off">,
  width: number,
  header: string,
  avatar: Avatar | undefined,
): "full" | "compact" {
  if (requestedMode !== "auto") return requestedMode;
  if (!avatar || avatar.lines.length === 0 || width < AUTO_FULL_MIN_COLUMNS) return "compact";
  const avatarWidth = Math.max(...avatar.lines.map((line) => visibleWidth(line)));
  return visibleWidth(header) + 2 + avatarWidth <= width ? "full" : "compact";
}

export function renderAvatarWidget(
  character: Character,
  mood: string | undefined,
  avatar: Avatar | undefined,
  width = AVATAR_MAX_COLUMNS,
  requestedMode: Exclude<AvatarMode, "off"> = "full",
): string[] {
  const moodLabel = mood ? ` · mood: ${mood}` : "";
  const header = truncateToWidth(`pi-incarnate · ${character.name}${moodLabel}`, width, "…");
  const mode = resolveAvatarMode(requestedMode, width, header, avatar);
  if (mode === "compact" || !avatar || avatar.lines.length === 0) return [header];

  const avatarWidth = Math.min(width, Math.max(...avatar.lines.map((line) => visibleWidth(line))));
  const canShareLastLine = visibleWidth(header) + 2 + avatarWidth <= width;
  const renderedAvatar = avatar.lines.map((line) => rightAlign(line, width));
  if (!canShareLastLine) return [...renderedAvatar, header];

  const lastAvatarLine = truncateToWidth(avatar.lines.at(-1) ?? "", avatarWidth, "");
  const gap = " ".repeat(Math.max(2, width - visibleWidth(header) - visibleWidth(lastAvatarLine)));
  return [...renderedAvatar.slice(0, -1), `${header}${gap}${lastAvatarLine}`];
}

export function createAvatarWidget(
  character: Character,
  mood: string | undefined,
  avatar: Avatar | undefined,
  mode: Exclude<AvatarMode, "off">,
): Component {
  return {
    render(width: number): string[] {
      return renderAvatarWidget(character, mood, avatar, width, mode);
    },
    invalidate() {},
  };
}
