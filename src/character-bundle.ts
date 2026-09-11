import { link, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";

import {
  installPersonalAvatar,
  prepareAvatarContent,
  prepareAvatarImport,
  preparePngAvatarContent,
  type PreparedAvatarImport,
} from "./avatar-manager.ts";
import {
  CharacterEditError,
  createPersonalCharacter,
} from "./character-editor.ts";
import { FORM_MAX_BYTES, readFormDraft, savePersonalForm } from "./form-editor.ts";
import { parseFormDeclarations } from "./forms.ts";
import { isCharacterId, loadCharacter, parseCharacterCard, type Character } from "./character-loader.ts";

export const CHARACTER_BUNDLE_FORMAT = "pi-incarnate-character";
export const CHARACTER_BUNDLE_VERSION = 1;
export const CHARACTER_BUNDLE_SUFFIX = ".pi-character.json";
export const CHARACTER_BUNDLE_MAX_BYTES = 1024 * 1024;
const CHARACTER_CARD_MAX_BYTES = 512 * 1024;
const CHARACTER_BUNDLE_MAX_FILES = 66;

interface CharacterBundleFileV1 {
  path: string;
  content: string;
  encoding?: "base64";
}

interface CharacterBundleDocumentV1 {
  format: typeof CHARACTER_BUNDLE_FORMAT;
  version: typeof CHARACTER_BUNDLE_VERSION;
  id: string;
  files: CharacterBundleFileV1[];
}

export interface PreparedCharacterBundle {
  id: string;
  name: string;
  card: string;
  avatars: PreparedAvatarImport[];
  forms: Array<{ path: string; content: string }>;
}

export interface CharacterBundleSummary {
  id: string;
  name: string;
  avatarIncluded: boolean;
  formsIncluded: number;
  formsDeclared: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function normalizeDeclaredFormPath(value: string): string {
  if (
    !value ||
    value.includes("\\") ||
    value.includes("\0") ||
    isAbsolute(value) ||
    posix.isAbsolute(value) ||
    /^[a-zA-Z]:/.test(value)
  ) {
    throw new CharacterEditError(`Invalid character bundle path: ${value}`);
  }
  const normalized = posix.normalize(value);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new CharacterEditError(`Invalid character bundle path: ${value}`);
  }
  return normalized;
}

function normalizePortablePath(value: string): string {
  const normalized = normalizeDeclaredFormPath(value);
  if (normalized !== value) throw new CharacterEditError(`Invalid character bundle path: ${value}`);
  return normalized;
}

function portableRelativePath(root: string, target: string): string {
  const value = relative(root, target).split(sep).join("/");
  return normalizePortablePath(value);
}

function assertBundleTarget(path: string): void {
  if (!path.toLowerCase().endsWith(CHARACTER_BUNDLE_SUFFIX)) {
    throw new CharacterEditError(`Character bundle must end in ${CHARACTER_BUNDLE_SUFFIX}`);
  }
}

async function assertMissing(path: string, message: string): Promise<void> {
  try {
    await lstat(path);
    throw new CharacterEditError(message);
  } catch (error) {
    if (error instanceof CharacterEditError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function readRegularUtf8(path: string, maximumBytes: number, label: string): Promise<string> {
  let bytes: Buffer;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new CharacterEditError(`${label} must be a regular file: ${path}`);
    }
    if (info.size > maximumBytes) throw new CharacterEditError(`${label} exceeds the ${maximumBytes}-byte limit`);
    bytes = await readFile(path);
  } catch (error) {
    if (error instanceof CharacterEditError) throw error;
    throw new CharacterEditError(`Cannot read ${label.toLowerCase()}: ${path}`);
  }
  if (bytes.byteLength > maximumBytes) throw new CharacterEditError(`${label} exceeds the ${maximumBytes}-byte limit`);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CharacterEditError(`${label} is not valid UTF-8: ${path}`);
  }
}

async function bundleDocument(character: Character): Promise<{ document: CharacterBundleDocumentV1; summary: CharacterBundleSummary }> {
  const card = `${character.markdown.trimEnd()}\n`;
  if (byteLength(card) > CHARACTER_CARD_MAX_BYTES) {
    throw new CharacterEditError(`CHARACTER.md exceeds the ${CHARACTER_CARD_MAX_BYTES}-byte bundle limit`);
  }
  const files: CharacterBundleFileV1[] = [{ path: "CHARACTER.md", content: card }];

  let avatarIncluded = false;
  for (const filename of ["avatar.png"] as const) {
    const avatarPath = join(character.directory, filename);
    try {
      await lstat(avatarPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new CharacterEditError(`Cannot inspect avatar for export: ${avatarPath}`);
    }
    const avatar = await prepareAvatarImport(avatarPath);
    if (avatar.kind !== "png") throw new CharacterEditError(`Unexpected avatar format: ${avatarPath}`);
    files.push({ path: avatar.filename, content: avatar.content.toString("base64"), encoding: "base64" });
    avatarIncluded = true;
  }
  for (const filename of ["avatar.ansi", "avatar.txt"] as const) {
    const avatarPath = join(character.directory, filename);
    try {
      await lstat(avatarPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new CharacterEditError(`Cannot inspect avatar for export: ${avatarPath}`);
    }
    const avatar = await prepareAvatarImport(avatarPath);
    if (avatar.kind !== "text") throw new CharacterEditError(`Unexpected avatar format: ${avatarPath}`);
    files.push({ path: avatar.filename, content: avatar.content });
    avatarIncluded = true;
    break;
  }

  const includedForms = new Set<string>();
  for (const form of character.forms) {
    if (form.status !== "available") continue;
    const draft = await readFormDraft(character.directory, form.declaredPath, form.label);
    if (!draft.exists) continue;
    const path = portableRelativePath(character.directory, draft.path);
    if (includedForms.has(path)) continue;
    includedForms.add(path);
    files.push({ path, content: draft.content });
  }

  if (files.length > CHARACTER_BUNDLE_MAX_FILES) {
    throw new CharacterEditError(`Character bundle exceeds the ${CHARACTER_BUNDLE_MAX_FILES}-file limit`);
  }
  const document: CharacterBundleDocumentV1 = {
    format: CHARACTER_BUNDLE_FORMAT,
    version: CHARACTER_BUNDLE_VERSION,
    id: character.id,
    files,
  };
  const encoded = `${JSON.stringify(document, null, 2)}\n`;
  if (byteLength(encoded) > CHARACTER_BUNDLE_MAX_BYTES) {
    throw new CharacterEditError(`Character bundle exceeds the ${CHARACTER_BUNDLE_MAX_BYTES}-byte limit`);
  }
  return {
    document,
    summary: {
      id: character.id,
      name: character.name,
      avatarIncluded,
      formsIncluded: includedForms.size,
      formsDeclared: character.forms.length,
    },
  };
}

export async function writeCharacterBundle(
  character: Character,
  targetPath: string,
): Promise<CharacterBundleSummary> {
  assertBundleTarget(targetPath);
  const requestedTarget = resolve(targetPath);
  const parent = dirname(requestedTarget);
  let canonicalParent: string;
  try {
    const info = await lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new CharacterEditError(`Bundle destination parent must be a real directory: ${parent}`);
    }
    canonicalParent = await realpath(parent);
  } catch (error) {
    if (error instanceof CharacterEditError) throw error;
    throw new CharacterEditError(`Cannot access bundle destination directory: ${parent}`);
  }
  const target = join(canonicalParent, basename(requestedTarget));
  await assertMissing(target, `Character bundle already exists: ${target}`);
  const { document, summary } = await bundleDocument(character);
  const temporaryPath = join(canonicalParent, `.incarnate-export-${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await link(temporaryPath, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new CharacterEditError(`Character bundle already exists: ${target}`);
    }
    if (error instanceof CharacterEditError) throw error;
    throw new CharacterEditError(`Cannot write character bundle: ${target}`);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return summary;
}

function decodeBase64(value: string, path: string): Buffer {
  if (value.length === 0 || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new CharacterEditError(`Character bundle contains invalid base64 content: ${path}`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new CharacterEditError(`Character bundle contains non-canonical base64 content: ${path}`);
  }
  return decoded;
}

function bundleAvatarEntry(avatar: PreparedAvatarImport): CharacterBundleFileV1 {
  return avatar.kind === "png"
    ? { path: avatar.filename, content: avatar.content.toString("base64"), encoding: "base64" }
    : { path: avatar.filename, content: avatar.content };
}

function validateBundleDocument(value: unknown): PreparedCharacterBundle {
  if (!isRecord(value) || value.format !== CHARACTER_BUNDLE_FORMAT || value.version !== CHARACTER_BUNDLE_VERSION) {
    throw new CharacterEditError("Unsupported character bundle format or version");
  }
  if (typeof value.id !== "string" || !isCharacterId(value.id)) {
    throw new CharacterEditError("Character bundle has an invalid id");
  }
  if (!Array.isArray(value.files) || value.files.length === 0 || value.files.length > CHARACTER_BUNDLE_MAX_FILES) {
    throw new CharacterEditError(`Character bundle must contain 1-${CHARACTER_BUNDLE_MAX_FILES} files`);
  }

  const files = new Map<string, CharacterBundleFileV1>();
  let contentBytes = 0;
  for (const entry of value.files) {
    if (
      !isRecord(entry) ||
      typeof entry.path !== "string" ||
      typeof entry.content !== "string" ||
      (entry.encoding !== undefined && entry.encoding !== "base64")
    ) {
      throw new CharacterEditError("Character bundle contains an invalid file entry");
    }
    const path = normalizePortablePath(entry.path);
    if (files.has(path)) throw new CharacterEditError(`Character bundle contains a duplicate path: ${path}`);
    contentBytes += byteLength(entry.content);
    if (contentBytes > CHARACTER_BUNDLE_MAX_BYTES) {
      throw new CharacterEditError(`Character bundle content exceeds the ${CHARACTER_BUNDLE_MAX_BYTES}-byte limit`);
    }
    files.set(path, { path, content: entry.content, ...(entry.encoding === "base64" ? { encoding: "base64" as const } : {}) });
  }

  const cardEntry = files.get("CHARACTER.md");
  if (cardEntry === undefined) throw new CharacterEditError("Character bundle is missing CHARACTER.md");
  if (cardEntry.encoding !== undefined) throw new CharacterEditError("CHARACTER.md must use UTF-8 text content");
  const card = cardEntry.content;
  if (byteLength(card) > CHARACTER_CARD_MAX_BYTES) {
    throw new CharacterEditError(`CHARACTER.md exceeds the ${CHARACTER_CARD_MAX_BYTES}-byte bundle limit`);
  }
  const parsed = parseCharacterCard(card, "CHARACTER.md");
  const allowedForms = new Set<string>();
  for (const declaration of parseFormDeclarations(card)) {
    try {
      const path = normalizeDeclaredFormPath(declaration.declaredPath);
      if (extname(path).toLowerCase() === ".md" && path !== "CHARACTER.md") allowedForms.add(path);
    } catch {
      // Invalid declarations remain unavailable after import and cannot authorize bundled files.
    }
  }

  const avatars: PreparedAvatarImport[] = [];
  let textAvatarFound = false;
  let pngAvatarFound = false;
  const forms: Array<{ path: string; content: string }> = [];
  for (const [path, entry] of files) {
    if (path === "CHARACTER.md") continue;
    const { content, encoding } = entry;
    if (path === "avatar.png") {
      if (pngAvatarFound) throw new CharacterEditError("Character bundle may contain only one PNG avatar");
      if (encoding !== "base64") throw new CharacterEditError("avatar.png must use base64 content");
      avatars.push(preparePngAvatarContent(decodeBase64(content, path)));
      pngAvatarFound = true;
      continue;
    }
    if (path === "avatar.ansi" || path === "avatar.txt") {
      if (textAvatarFound) throw new CharacterEditError("Character bundle may contain only one text avatar fallback");
      if (encoding !== undefined) throw new CharacterEditError(`${path} must use UTF-8 text content`);
      avatars.push(prepareAvatarContent(path, content));
      textAvatarFound = true;
      continue;
    }
    if (encoding !== undefined) throw new CharacterEditError(`Character bundle text file must not use base64: ${path}`);
    if (!allowedForms.has(path)) {
      throw new CharacterEditError(`Character bundle contains an undeclared file: ${path}`);
    }
    if (byteLength(content) > FORM_MAX_BYTES) {
      throw new CharacterEditError(`Form exceeds the ${FORM_MAX_BYTES}-byte limit: ${path}`);
    }
    forms.push({ path, content });
  }
  return { id: value.id, name: parsed.name, card, avatars, forms };
}

export async function prepareCharacterBundleImport(sourcePath: string): Promise<PreparedCharacterBundle> {
  assertBundleTarget(sourcePath);
  const content = await readRegularUtf8(sourcePath, CHARACTER_BUNDLE_MAX_BYTES, "Character bundle");
  let document: unknown;
  try {
    document = JSON.parse(content);
  } catch {
    throw new CharacterEditError("Character bundle is not valid JSON");
  }
  return validateBundleDocument(document);
}

export async function installCharacterBundle(
  personalRoot: string,
  bundle: PreparedCharacterBundle,
): Promise<Character> {
  const validated = validateBundleDocument({
    format: CHARACTER_BUNDLE_FORMAT,
    version: CHARACTER_BUNDLE_VERSION,
    id: bundle.id,
    files: [
      { path: "CHARACTER.md", content: bundle.card },
      ...bundle.avatars.map(bundleAvatarEntry),
      ...bundle.forms.map((form) => ({ path: form.path, content: form.content })),
    ],
  });
  await mkdir(personalRoot, { recursive: true });
  const canonicalRoot = await realpath(personalRoot);
  const target = join(canonicalRoot, validated.id);
  await assertMissing(target, `A personal character already exists: ${validated.id}`);
  const stagingRoot = await mkdtemp(join(canonicalRoot, ".incarnate-import-"));
  try {
    await createPersonalCharacter(stagingRoot, validated.id, validated.card);
    for (const form of validated.forms) {
      await savePersonalForm(stagingRoot, validated.id, form.path, form.content);
    }
    for (const avatar of validated.avatars) await installPersonalAvatar(stagingRoot, validated.id, avatar);
    const staged = await loadCharacter(stagingRoot, validated.id);
    await rename(staged.directory, target);
    return await loadCharacter(canonicalRoot, validated.id);
  } catch (error) {
    if (error instanceof CharacterEditError) throw error;
    throw new CharacterEditError(`Cannot install character bundle: ${error instanceof Error ? error.message : "unknown error"}`);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}
