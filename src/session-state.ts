import type { Character } from "./character-loader.ts";

export interface IncarnateStateSnapshot {
  activeCharacter?: Character;
  currentMood?: string;
  avatarEnabled: boolean;
}

export class IncarnateSessionState {
  #activeCharacter: Character | undefined;
  #currentMood: string | undefined;
  #avatarEnabled = true;

  get activeCharacter(): Character | undefined {
    return this.#activeCharacter;
  }

  get currentMood(): string | undefined {
    return this.#currentMood;
  }

  get avatarEnabled(): boolean {
    return this.#avatarEnabled;
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
    this.#avatarEnabled = enabled;
  }

  reset(): void {
    this.deactivate();
    this.#avatarEnabled = true;
  }

  snapshot(): IncarnateStateSnapshot {
    return {
      activeCharacter: this.#activeCharacter,
      currentMood: this.#currentMood,
      avatarEnabled: this.#avatarEnabled,
    };
  }
}
