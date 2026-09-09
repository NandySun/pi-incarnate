export interface MarkdownSection {
  name: string;
  content: string;
}

interface MarkdownHeading {
  line: number;
  name: string;
}

function findHeadings(markdown: string, level: number): { lines: string[]; headings: MarkdownHeading[] } {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const headings: MarkdownHeading[] = [];
  let fence: { marker: string; length: number } | undefined;
  const headingPattern = new RegExp(`^#{${level}}(?!#)\\s+(.+?)(?:\\s+#+)?\\s*$`);

  lines.forEach((line, index) => {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = { marker, length: fenceMatch[1].length };
      else if (fence.marker === marker && fenceMatch[1].length >= fence.length) fence = undefined;
      return;
    }
    if (fence) return;
    const headingMatch = line.match(headingPattern);
    if (headingMatch) headings.push({ line: index, name: headingMatch[1].trim() });
  });
  return { lines, headings };
}

export function findLevelOneHeading(markdown: string): string | undefined {
  return findHeadings(markdown, 1).headings[0]?.name;
}

export function extractSections(markdown: string, level: number): MarkdownSection[] {
  const { lines, headings } = findHeadings(markdown, level);
  return headings.map((current, index) => {
    const next = headings[index + 1];
    return {
      name: current.name,
      content: lines.slice(current.line + 1, next?.line ?? lines.length).join("\n").trim(),
    };
  });
}

export function contentBeforeFirstHeading(markdown: string, level: number): string {
  const { lines, headings } = findHeadings(markdown, level);
  return lines.slice(0, headings[0]?.line ?? lines.length).join("\n").trim();
}

export function extractLevelTwoSections(markdown: string): MarkdownSection[] {
  return extractSections(markdown, 2);
}

export function findLevelTwoSection(markdown: string, name: string): string | undefined {
  return extractLevelTwoSections(markdown).find((section) => section.name.toLowerCase() === name.toLowerCase())?.content;
}

export function removeLevelTwoSection(markdown: string, name: string): string {
  const { lines, headings } = findHeadings(markdown, 2);
  const excluded = new Set<number>();
  headings.forEach((heading, index) => {
    if (heading.name.toLowerCase() !== name.toLowerCase()) return;
    const end = headings[index + 1]?.line ?? lines.length;
    for (let line = heading.line; line < end; line += 1) excluded.add(line);
  });
  if (excluded.size === 0) return markdown;
  return lines.filter((_line, index) => !excluded.has(index)).join("\n").trim();
}
