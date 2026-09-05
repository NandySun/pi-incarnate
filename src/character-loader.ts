import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import { resolveFormReferences, type FormReference } from "./forms.ts";
import { extractLevelTwoSections, findLevelOneHeading } from "./markdown.ts";
import { MoodConfigError, parseMoodConfig, type MoodConfig } from "./mood.ts";

const CHARACTER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const REQUIRED_SECTIONS = ["Identity", "Personality", "Speech Style", "Behavior"] as const;

export type RequiredSection = (typeof REQUIRED_SECTIONS)[number];

export interface Character {
  id: string;
  name: string;
  directory: string;
  cardPath: string;
  markdown: string;
  sections: Readonly<Record<RequiredSection, string>>;
  mood: MoodConfig;
  forms: readonly FormReference[];
}

export type CharacterIssueCode =
  | "invalid-directory"
  | "missing-card"
  | "invalid-encoding"
  | "invalid-card"
  | "outside-root"
  | "unreadable";

export interface CharacterIssue {
  id: string;
  path: string;
  code: CharacterIssueCode;
  message: string;
}

export interface CharacterDiscovery {
  characters: Character[];
  issues: CharacterIssue[];
}

export interface ParsedCharacterCard {
  markdown: string;
  name: string;
  sections: Readonly<Record<RequiredSection, string>>;
  mood: MoodConfig;
}

export class CharacterLoadError extends Error {
  readonly code: CharacterIssueCode;
  readonly path: string;

  constructor(code: CharacterIssueCode, message: string, path: string) {
    super(message);
    this.name = "CharacterLoadError";
    this.code = code;
    this.path = path;
  }
}

function isWithin(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return pathFromParent === "" || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== "..");
}

function decodeUtf8(buffer: Buffer, cardPath: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new CharacterLoadError("invalid-encoding", `CHARACTER.md is not valid UTF-8: ${cardPath}`, cardPath);
  }
}

function parseCard(markdown: string, cardPath: string): Pick<Character, "name" | "sections"> {
  const normalized = markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  const heading = findLevelOneHeading(normalized);
  if (!heading) {
    throw new CharacterLoadError("invalid-card", "CHARACTER.md must contain a level-one character name", cardPath);
  }

  const parsedSections = new Map(
    extractLevelTwoSections(normalized).map((section) => [section.name.toLowerCase(), section.content]),
  );

  const missing = REQUIRED_SECTIONS.filter((section) => !parsedSections.get(section.toLowerCase()));
  if (missing.length > 0) {
    throw new CharacterLoadError(
      "invalid-card",
      `CHARACTER.md is missing required non-empty sections: ${missing.join(", ")}`,
      cardPath,
    );
  }

  return {
    name: heading.trim(),
    sections: Object.fromEntries(
      REQUIRED_SECTIONS.map((section) => [section, parsedSections.get(section.toLowerCase())!]),
    ) as Record<RequiredSection, string>,
  };
}

export function parseCharacterCard(markdown: string, cardPath = "CHARACTER.md"): ParsedCharacterCard {
  const normalized = markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  const parsed = parseCard(normalized, cardPath);
  let mood: MoodConfig;
  try {
    mood = parseMoodConfig(normalized);
  } catch (error) {
    const message = error instanceof MoodConfigError ? error.message : "Invalid Current Mood section";
    throw new CharacterLoadError("invalid-card", message, cardPath);
  }
  return { markdown: normalized, mood, ...parsed };
}

export function isCharacterId(value: string): boolean {
  return CHARACTER_ID_PATTERN.test(value);
}

export async function loadCharacter(charactersRoot: string, id: string): Promise<Character> {
  const root = resolve(charactersRoot);
  if (!isCharacterId(id)) {
    throw new CharacterLoadError("invalid-directory", `Invalid character id: ${id}`, join(root, id));
  }

  let canonicalRoot: string;
  let characterDirectory: string;
  try {
    canonicalRoot = await realpath(root);
    const directoryInfo = await lstat(join(root, id));
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
      throw new CharacterLoadError("invalid-directory", `Character path is not a regular directory: ${id}`, join(root, id));
    }
    characterDirectory = await realpath(join(root, id));
  } catch (error) {
    if (error instanceof CharacterLoadError) throw error;
    throw new CharacterLoadError("missing-card", `Character does not exist: ${id}`, join(root, id));
  }

  if (!isWithin(canonicalRoot, characterDirectory) || dirname(characterDirectory) !== canonicalRoot) {
    throw new CharacterLoadError("outside-root", `Character directory escapes the characters root: ${id}`, characterDirectory);
  }

  const cardPath = join(characterDirectory, "CHARACTER.md");
  try {
    if (!(await stat(characterDirectory)).isDirectory()) {
      throw new CharacterLoadError("invalid-directory", `Character path is not a directory: ${id}`, characterDirectory);
    }
  } catch (error) {
    if (error instanceof CharacterLoadError) throw error;
    throw new CharacterLoadError("unreadable", `Cannot inspect character directory: ${id}`, characterDirectory);
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(cardPath);
  } catch {
    throw new CharacterLoadError("missing-card", `Missing or unreadable CHARACTER.md for: ${id}`, cardPath);
  }

  const parsed = parseCharacterCard(decodeUtf8(buffer, cardPath), cardPath);
  const forms = await resolveFormReferences(characterDirectory, parsed.markdown);
  return { id, directory: characterDirectory, cardPath, forms, ...parsed };
}

export async function discoverCharacters(charactersRoot: string): Promise<CharacterDiscovery> {
  const root = resolve(charactersRoot);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { characters: [], issues: [] };
    throw error;
  }

  const characters: Character[] = [];
  const issues: CharacterIssue[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) {
      issues.push({
        id: entry.name,
        path: join(root, entry.name),
        code: "invalid-directory",
        message: `Ignored symbolic-link character directory: ${entry.name}`,
      });
      continue;
    }
    if (!entry.isDirectory()) continue;
    if (!isCharacterId(entry.name)) {
      issues.push({
        id: entry.name,
        path: join(root, entry.name),
        code: "invalid-directory",
        message: `Ignored invalid character directory: ${entry.name}`,
      });
      continue;
    }

    try {
      characters.push(await loadCharacter(root, entry.name));
    } catch (error) {
      const loadError =
        error instanceof CharacterLoadError
          ? error
          : new CharacterLoadError("unreadable", `Cannot load character: ${entry.name}`, join(root, entry.name));
      issues.push({ id: entry.name, path: loadError.path, code: loadError.code, message: loadError.message });
    }
  }

  return { characters, issues };
}
