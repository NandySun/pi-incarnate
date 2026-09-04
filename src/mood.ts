import { contentBeforeFirstHeading, extractSections, findLevelTwoSection } from "./markdown.ts";

const PRESET_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export interface MoodPreset {
  id: string;
  instruction: string;
}

export interface MoodConfig {
  defaultPreset?: string;
  presets: ReadonlyMap<string, MoodPreset>;
}

export class MoodConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoodConfigError";
  }
}

export function parseMoodConfig(markdown: string): MoodConfig {
  const section = findLevelTwoSection(markdown, "Current Mood");
  if (section === undefined) return { presets: new Map() };

  const defaultMatch = contentBeforeFirstHeading(section, 3).match(/^Default:\s*(\S+)\s*$/im);
  if (!defaultMatch) throw new MoodConfigError("Current Mood must declare 'Default: <preset-id>'");

  const presetSections = extractSections(section, 3);
  if (presetSections.length === 0) throw new MoodConfigError("Current Mood must define at least one level-three preset");

  const presets = new Map<string, MoodPreset>();
  for (const presetSection of presetSections) {
    const id = presetSection.name;
    if (!PRESET_ID_PATTERN.test(id)) throw new MoodConfigError(`Invalid mood preset id: ${id}`);
    if (presets.has(id)) throw new MoodConfigError(`Duplicate mood preset: ${id}`);
    const instruction = presetSection.content;
    if (!instruction) throw new MoodConfigError(`Mood preset must not be empty: ${id}`);
    presets.set(id, { id, instruction });
  }

  const defaultPreset = defaultMatch[1];
  if (!presets.has(defaultPreset)) {
    throw new MoodConfigError(`Default mood does not match a declared preset: ${defaultPreset}`);
  }
  return { defaultPreset, presets };
}

export function composeMoodPrompt(config: MoodConfig, presetId: string | undefined): string | undefined {
  if (!presetId) return undefined;
  const preset = config.presets.get(presetId);
  if (!preset) return undefined;
  return `Current mood preset: ${preset.id}\n${preset.instruction}\nThe mood adjusts expression only; it does not override the character's identity, factual standards, or tool rules.`;
}
