import { lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  discoverCharacters,
  loadCharacter,
  type Character,
  type CharacterIssue,
} from "./character-loader.ts";

export type CharacterSource = "personal" | "built-in";

export interface CharacterLocations {
  builtInRoot: string;
  personalRoot?: string;
}

export interface CharacterCatalogEntry {
  character: Character;
  source: CharacterSource;
}

export interface CharacterCatalog {
  entries: CharacterCatalogEntry[];
  issues: CharacterIssue[];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function discoverCharacterCatalog(locations: CharacterLocations): Promise<CharacterCatalog> {
  const roots: Array<{ root: string; source: CharacterSource }> = [];
  if (locations.personalRoot) roots.push({ root: locations.personalRoot, source: "personal" });
  roots.push({ root: locations.builtInRoot, source: "built-in" });

  const entries: CharacterCatalogEntry[] = [];
  const issues: CharacterIssue[] = [];
  const seen = new Set<string>();
  for (const { root, source } of roots) {
    const discovery = await discoverCharacters(root);
    issues.push(...discovery.issues);
    for (const character of discovery.characters) {
      if (seen.has(character.id)) continue;
      seen.add(character.id);
      entries.push({ character, source });
    }
  }
  entries.sort((left, right) => left.character.id.localeCompare(right.character.id));
  return { entries, issues };
}

export async function loadCatalogCharacter(locations: CharacterLocations, id: string): Promise<CharacterCatalogEntry> {
  if (locations.personalRoot && (await pathExists(join(locations.personalRoot, id)))) {
    return { character: await loadCharacter(locations.personalRoot, id), source: "personal" };
  }
  return { character: await loadCharacter(locations.builtInRoot, id), source: "built-in" };
}

export function characterSource(character: Character, locations: CharacterLocations): CharacterSource {
  if (locations.personalRoot && dirname(character.directory) === resolve(locations.personalRoot)) return "personal";
  return "built-in";
}
