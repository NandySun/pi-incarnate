import { readFile, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { Character } from "./character-loader.ts";

export const AVATAR_MAX_COLUMNS = 48;
export const AVATAR_MAX_LINES = 16;
export const AVATAR_MAX_BYTES = 64 * 1024;
export const AVATAR_PNG_MAX_BYTES = 512 * 1024;
export const AVATAR_PNG_MAX_DIMENSION = 2048;
export const AVATAR_PNG_MAX_PIXELS = 2048 * 2048;
const ANSI_RESET = "\u001b[0m";
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
const CSI_SEQUENCE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export interface Avatar {
  lines: string[];
  truncated: boolean;
  image?: AvatarImage;
}

export interface AvatarImage {
  mimeType: "image/png";
  data: string;
  widthPx: number;
  heightPx: number;
  bytes: number;
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

function pngChunkCrc(buffer: Buffer, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = CRC32_TABLE[(crc ^ buffer[index]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function validatePngAvatar(bytes: Uint8Array): AvatarImage {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.byteLength > AVATAR_PNG_MAX_BYTES) {
    throw new AvatarLoadError(`avatar.png exceeds the ${AVATAR_PNG_MAX_BYTES}-byte limit`);
  }
  if (buffer.byteLength < 45 || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new AvatarLoadError("avatar.png is not a valid PNG file");
  }

  let offset = PNG_SIGNATURE.length;
  let widthPx = 0;
  let heightPx = 0;
  let sawImageData = false;
  let sawEnd = false;
  while (offset + 12 <= buffer.byteLength) {
    const chunkLength = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + chunkLength;
    if (chunkEnd > buffer.byteLength) throw new AvatarLoadError("avatar.png contains a truncated PNG chunk");
    const chunkType = buffer.toString("ascii", offset + 4, offset + 8);
    if (pngChunkCrc(buffer, offset + 4, offset + 8 + chunkLength) !== buffer.readUInt32BE(offset + 8 + chunkLength)) {
      throw new AvatarLoadError(`avatar.png has an invalid ${chunkType} checksum`);
    }
    if (offset === PNG_SIGNATURE.length) {
      if (chunkType !== "IHDR" || chunkLength !== 13) {
        throw new AvatarLoadError("avatar.png must begin with a valid IHDR chunk");
      }
      widthPx = buffer.readUInt32BE(offset + 8);
      heightPx = buffer.readUInt32BE(offset + 12);
      const bitDepth = buffer[offset + 16]!;
      const colorType = buffer[offset + 17]!;
      const validDepths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        widthPx === 0 ||
        heightPx === 0 ||
        widthPx > AVATAR_PNG_MAX_DIMENSION ||
        heightPx > AVATAR_PNG_MAX_DIMENSION ||
        widthPx * heightPx > AVATAR_PNG_MAX_PIXELS
      ) {
        throw new AvatarLoadError(
          `avatar.png must be at most ${AVATAR_PNG_MAX_DIMENSION}×${AVATAR_PNG_MAX_DIMENSION} pixels and ${AVATAR_PNG_MAX_PIXELS} total pixels`,
        );
      }
      if (
        !validDepths[colorType]?.includes(bitDepth) ||
        buffer[offset + 18] !== 0 ||
        buffer[offset + 19] !== 0 ||
        (buffer[offset + 20] !== 0 && buffer[offset + 20] !== 1)
      ) {
        throw new AvatarLoadError("avatar.png has an unsupported PNG header");
      }
    } else if (chunkType === "IHDR") {
      throw new AvatarLoadError("avatar.png contains multiple IHDR chunks");
    }
    if (chunkType === "IDAT") sawImageData = true;
    if (chunkType === "IEND") {
      if (chunkLength !== 0 || chunkEnd !== buffer.byteLength) {
        throw new AvatarLoadError("avatar.png has an invalid IEND chunk");
      }
      sawEnd = true;
      break;
    }
    offset = chunkEnd;
  }
  if (!sawImageData || !sawEnd) throw new AvatarLoadError("avatar.png is missing required PNG chunks");

  return {
    mimeType: "image/png",
    data: buffer.toString("base64"),
    widthPx,
    heightPx,
    bytes: buffer.byteLength,
  };
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

async function loadPngAvatar(character: Character): Promise<AvatarImage | undefined> {
  const filename = "avatar.png";
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
  try {
    return validatePngAvatar(bytes);
  } catch (error) {
    if (error instanceof AvatarLoadError) {
      throw new AvatarLoadError(`${error.message}: ${avatarPath}`);
    }
    throw error;
  }
}

export async function loadAvatar(character: Character): Promise<Avatar | undefined> {
  const image = await loadPngAvatar(character);
  const ansi = await loadAvatarFile(character, "avatar.ansi", true);
  const fallback = ansi ?? await loadAvatarFile(character, "avatar.txt", false);
  if (!image) return fallback;
  return { lines: fallback?.lines ?? [], truncated: fallback?.truncated ?? false, image };
}
