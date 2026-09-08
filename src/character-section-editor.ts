import { CharacterEditError } from "./character-editor.ts";

export const GUIDED_CHARACTER_SECTIONS = [
  "Identity",
  "Personality",
  "Speech Style",
  "Behavior",
  "Current Mood",
  "Tools and Forms",
] as const;

export type GuidedCharacterSection = (typeof GUIDED_CHARACTER_SECTIONS)[number];

export interface CharacterSectionDraft {
  content: string;
  exists: boolean;
}

interface HeadingLocation {
  level: number;
  line: number;
  name: string;
}

function normalizedLines(markdown: string): string[] {
  return markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
}

function headings(lines: readonly string[]): HeadingLocation[] {
  const locations: HeadingLocation[] = [];
  let fence: { marker: string; length: number } | undefined;
  lines.forEach((line, index) => {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1]![0]!;
      if (!fence) fence = { marker, length: fenceMatch[1]!.length };
      else if (fence.marker === marker && fenceMatch[1]!.length >= fence.length) fence = undefined;
      return;
    }
    if (fence) return;
    const match = line.match(/^(#{1,6})(?!#)\s+(.+?)(?:\s+#+)?\s*$/);
    if (match) locations.push({ level: match[1]!.length, line: index, name: match[2]!.trim() });
  });
  return locations;
}

function normalizeBody(content: string): string {
  return content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
}

function finish(lines: readonly string[]): string {
  return `${lines.join("\n").trimEnd()}\n`;
}

function sectionLocation(lines: readonly string[], name: string): { heading: HeadingLocation; endLine: number } | undefined {
  const levelTwo = headings(lines).filter((heading) => heading.level === 2);
  const matches = levelTwo.filter((heading) => heading.name.toLowerCase() === name.toLowerCase());
  if (matches.length > 1) throw new CharacterEditError(`Character card contains duplicate sections: ${name}`);
  const heading = matches[0];
  if (!heading) return undefined;
  const next = levelTwo.find((candidate) => candidate.line > heading.line);
  return { heading, endLine: next?.line ?? lines.length };
}

export function readCharacterSection(markdown: string, name: GuidedCharacterSection): CharacterSectionDraft {
  const lines = normalizedLines(markdown);
  const location = sectionLocation(lines, name);
  if (!location) return { content: "", exists: false };
  return {
    content: lines.slice(location.heading.line + 1, location.endLine).join("\n").trim(),
    exists: true,
  };
}

export function updateCharacterSection(
  markdown: string,
  name: GuidedCharacterSection,
  content: string,
): string {
  const lines = normalizedLines(markdown);
  const location = sectionLocation(lines, name);
  const body = normalizeBody(content);
  if (headings(body.split("\n")).some((heading) => heading.level <= 2)) {
    throw new CharacterEditError("Section content cannot contain level-one or level-two headings; use the complete card editor");
  }
  if (!location) {
    const existing = lines.join("\n").trimEnd();
    return `${existing}\n\n## ${name}\n\n${body}${body ? "\n" : ""}`;
  }
  const replacement = body ? ["", ...body.split("\n"), ""] : [""];
  return finish([
    ...lines.slice(0, location.heading.line + 1),
    ...replacement,
    ...lines.slice(location.endLine),
  ]);
}

export function updateCharacterName(markdown: string, name: string): string {
  const normalizedName = name.trim().replace(/\s*[\r\n]+\s*/g, " ");
  if (!normalizedName) throw new CharacterEditError("Character name must not be empty");
  if (normalizedName.length > 120) throw new CharacterEditError("Character name must not exceed 120 characters");
  if (/\s#+$/.test(normalizedName)) {
    throw new CharacterEditError("Character name must not end with Markdown closing hashes");
  }
  const lines = normalizedLines(markdown);
  const firstHeading = headings(lines).find((heading) => heading.level === 1);
  if (!firstHeading) throw new CharacterEditError("CHARACTER.md must contain a level-one character name");
  lines[firstHeading.line] = `# ${normalizedName}`;
  return finish(lines);
}

export function sectionStarter(name: GuidedCharacterSection): string {
  if (name === "Current Mood") {
    return "Default: normal\n\n### normal\n\n保持角色的常态表达方式。";
  }
  if (name === "Tools and Forms") {
    return "- 偏好表名称：`forms/preferences.md`";
  }
  return "";
}
