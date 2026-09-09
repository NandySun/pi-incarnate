import { visibleWidth } from "@earendil-works/pi-tui";

import type { Avatar } from "./avatar.ts";
import { characterSource, type CharacterLocations, type CharacterSource } from "./character-catalog.ts";
import type { AvatarMode, IncarnateSessionState } from "./session-state.ts";

export const UI_REQUEST_STATE_EVENT = "pi-incarnate:ui:request-state-v1";
export const UI_STATE_EVENT = "pi-incarnate:ui:state-v1";

export interface IncarnateUiStateV1 {
  version: 1;
  active: boolean;
  avatarMode: AvatarMode;
  character?: {
    id: string;
    name: string;
    mood?: string;
    source: CharacterSource;
    forms: {
      available: number;
      total: number;
    };
  };
  avatar?: {
    lines: string[];
    width: number;
    height: number;
    truncated: boolean;
  };
}

export function isUiProtocolV1(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { version?: unknown }).version === 1);
}

export function createUiStateSnapshot(
  state: IncarnateSessionState,
  locations: CharacterLocations,
  avatar: Avatar | undefined,
): IncarnateUiStateV1 {
  const character = state.activeCharacter;
  if (!character) return { version: 1, active: false, avatarMode: state.avatarMode };

  const availableForms = character.forms.filter((form) => form.status === "available").length;
  const snapshot: IncarnateUiStateV1 = {
    version: 1,
    active: true,
    avatarMode: state.avatarMode,
    character: {
      id: character.id,
      name: character.name,
      mood: state.currentMood,
      source: characterSource(character, locations),
      forms: { available: availableForms, total: character.forms.length },
    },
  };
  if (avatar && state.avatarEnabled) {
    snapshot.avatar = {
      lines: [...avatar.lines],
      width: avatar.lines.reduce((maximum, line) => Math.max(maximum, visibleWidth(line)), 0),
      height: avatar.lines.length,
      truncated: avatar.truncated,
    };
  }
  return snapshot;
}
