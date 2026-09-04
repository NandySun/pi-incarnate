import type { Character } from "./character-loader.ts";
import { composeFormsPrompt } from "./forms.ts";
import { composeMoodPrompt } from "./mood.ts";

const RUNTIME_RULES = `You are operating with a pi-incarnate character persona.
- Treat the character card as guidance for identity, voice, interpersonal stance, and emotional expression.
- Preserve Pi's existing tools, permissions, safety rules, and task-completion standards.
- Never invent tool results, file contents, current facts, or actions that did not occur.
- Keep factual uncertainty explicit. Immersive style must not turn fiction into real-world claims.
- When the user asks for technical work, complete it accurately; express the result in character without sacrificing clarity.
- Do not mechanically repeat catchphrases or example dialogue.`;

export function composePersonaPrompt(character: Character, currentMood?: string): string {
  const formsPrompt = composeFormsPrompt(character.forms);
  const moodPrompt = composeMoodPrompt(character.mood, currentMood);
  return `${RUNTIME_RULES}

Active character: ${character.name} (${character.id})

<character-card>
${character.markdown}
</character-card>${formsPrompt ? `\n\n${formsPrompt}` : ""}${moodPrompt ? `\n\n${moodPrompt}` : ""}`;
}

export function appendPersonaPrompt(systemPrompt: string, character: Character, currentMood?: string): string {
  return `${systemPrompt}\n\n${composePersonaPrompt(character, currentMood)}`;
}
