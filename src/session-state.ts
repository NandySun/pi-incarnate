import type { Character } from "./character-loader.ts";

export type AvatarMode = "auto" | "full" | "compact" | "off";

export interface IncarnateStateSnapshot {
  activeCharacter?: Character;
  currentMood?: string;
  avatarMode: AvatarMode;
  avatarEnabled: boolean;
}

export class IncarnateSessionState {
  #activeCharacter: Character | undefined;
  #currentMood: string | undefined;
  #avatarMode: AvatarMode = "auto";

  get activeCharacter(): Character | undefined {
    return this.#activeCharacter;
  }

  get currentMood(): string | undefined {
    return this.#currentMood;
  }

  get avatarEnabled(): boolean {
    return this.#avatarMode !== "off";
  }

  get avatarMode(): AvatarMode {
    return this.#avatarMode;
  }

  activate(character: Character): void {
    this.#activeCharacter = character;
    this.#currentMood = character.mood.defaultPreset;
  }

  deactivate(): void {
    this.#activeCharacter = undefined;
    this.#currentMood = undefined;
  }

  setMood(preset: string): void {
    if (!this.#activeCharacter?.mood.presets.has(preset)) {
      throw new Error(`Unknown mood preset: ${preset}`);
    }
    this.#currentMood = preset;
  }

  setAvatarEnabled(enabled: boolean): void {
    this.#avatarMode = enabled ? "auto" : "off";
  }

  setAvatarMode(mode: AvatarMode): void {
    this.#avatarMode = mode;
  }

  reset(): void {
    this.deactivate();
    this.#avatarMode = "auto";
  }

  snapshot(): IncarnateStateSnapshot {
    return {
      activeCharacter: this.#activeCharacter,
      currentMood: this.#currentMood,
      avatarMode: this.#avatarMode,
      avatarEnabled: this.avatarEnabled,
    };
  }
}
