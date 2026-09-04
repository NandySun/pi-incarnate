import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";

import { AvatarLoadError, loadAvatar, renderAvatarWidget } from "../src/avatar.ts";
import { registerIncarnateCommand } from "../src/commands.ts";
import { appendPersonaPrompt } from "../src/persona.ts";
import { IncarnateSessionState } from "../src/session-state.ts";

const charactersRoot = fileURLToPath(new URL("../characters", import.meta.url));

export default function incarnateExtension(pi: ExtensionAPI): void {
  const state = new IncarnateSessionState();

  const refreshWidget = async (ctx: ExtensionContext): Promise<void> => {
    if (!ctx.hasUI) return;
    const character = state.activeCharacter;
    if (!character || !state.avatarEnabled) {
      ctx.ui.setWidget("pi-incarnate", undefined);
      return;
    }
    try {
      const avatar = await loadAvatar(character);
      ctx.ui.setWidget("pi-incarnate", renderAvatarWidget(character, state.currentMood, avatar));
    } catch (error) {
      const message = error instanceof AvatarLoadError ? error.message : "Failed to load avatar";
      ctx.ui.setWidget("pi-incarnate", renderAvatarWidget(character, state.currentMood, undefined));
      ctx.ui.notify(message, "warning");
    }
  };

  registerIncarnateCommand(pi, { charactersRoot, state, onStateChange: refreshWidget });

  pi.on("session_start", async (_event, ctx) => {
    state.reset();
    await refreshWidget(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setWidget("pi-incarnate", undefined);
  });

  pi.on("before_agent_start", (event) => {
    const character = state.activeCharacter;
    if (!character) return undefined;
    return { systemPrompt: appendPersonaPrompt(event.systemPrompt, character, state.currentMood) };
  });
}
