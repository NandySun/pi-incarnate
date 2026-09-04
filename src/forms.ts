import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { findLevelTwoSection } from "./markdown.ts";

export type FormStatus = "available" | "missing" | "invalid";

export interface FormReference {
  label: string;
  declaredPath: string;
  resolvedPath?: string;
  status: FormStatus;
  reason?: string;
}

function isWithin(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent);
}

export function parseFormDeclarations(markdown: string): Array<{ label: string; declaredPath: string }> {
  const section = findLevelTwoSection(markdown, "Tools and Forms");
  if (section === undefined) return [];

  const declarations: Array<{ label: string; declaredPath: string }> = [];
  for (const match of section.matchAll(/^-\s+([^:：\n]+?)\s*[:：]\s*`([^`]+)`\s*$/gm)) {
    declarations.push({ label: match[1].trim(), declaredPath: match[2].trim() });
  }
  return declarations;
}

export async function resolveFormReferences(characterDirectory: string, markdown: string): Promise<FormReference[]> {
  const canonicalCharacterDirectory = await realpath(characterDirectory);
  const declarations = parseFormDeclarations(markdown);

  return await Promise.all(
    declarations.map(async ({ label, declaredPath }): Promise<FormReference> => {
      if (!declaredPath || isAbsolute(declaredPath)) {
        return { label, declaredPath, status: "invalid", reason: "path must be relative to the character directory" };
      }

      const candidate = resolve(canonicalCharacterDirectory, declaredPath);
      if (!isWithin(canonicalCharacterDirectory, candidate) || candidate === canonicalCharacterDirectory) {
        return { label, declaredPath, status: "invalid", reason: "path escapes the character directory" };
      }

      let canonicalPath: string;
      try {
        canonicalPath = await realpath(candidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return { label, declaredPath, resolvedPath: candidate, status: "missing", reason: "file does not exist" };
        }
        return { label, declaredPath, resolvedPath: candidate, status: "invalid", reason: "path is not readable" };
      }

      if (!isWithin(canonicalCharacterDirectory, canonicalPath)) {
        return { label, declaredPath, status: "invalid", reason: "resolved path escapes the character directory" };
      }

      try {
        if (!(await stat(canonicalPath)).isFile()) {
          return { label, declaredPath, resolvedPath: canonicalPath, status: "invalid", reason: "path is not a file" };
        }
        const handle = await open(canonicalPath, "r");
        await handle.close();
      } catch {
        return { label, declaredPath, resolvedPath: canonicalPath, status: "invalid", reason: "path is not readable" };
      }

      return { label, declaredPath, resolvedPath: canonicalPath, status: "available" };
    }),
  );
}

export function composeFormsPrompt(forms: readonly FormReference[]): string | undefined {
  if (forms.length === 0) return undefined;
  const lines = forms.map((form) => {
    if (form.status === "available") return `- ${form.label}: ${form.resolvedPath} (available)`;
    return `- ${form.label}: ${form.declaredPath} (${form.status}: ${form.reason})`;
  });
  return `Declared preference forms:\n${lines.join("\n")}\nOnly use these declared files when relevant. Read them with Pi's file tools before relying on their contents. Never imply that a missing or invalid form was read.`;
}
