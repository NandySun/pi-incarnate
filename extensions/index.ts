import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { AvatarLoadError, createAvatarWidget, loadAvatar, renderAvatarWidget, type Avatar } from "../src/avatar.ts";
import type { CharacterLocations } from "../src/character-catalog.ts";
import { registerIncarnateCommand } from "../src/commands.ts";
import { appendPersonaPrompt } from "../src/persona.ts";
import { IncarnateSessionState } from "../src/session-state.ts";
import {
  createUiStateSnapshot,
  isUiProtocolV1,
  UI_CLAIM_EVENT,
  UI_REQUEST_STATE_EVENT,
  UI_STATE_EVENT,
} from "../src/ui-protocol.ts";

const charactersRoot = fileURLToPath(new URL("../characters", import.meta.url));
const agentConfigRoot = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
const personalCharactersRoot = join(agentConfigRoot, "pi-incarnate", "characters");

export default function incarnateExtension(pi: ExtensionAPI): void {
  const state = new IncarnateSessionState();
  const locations: CharacterLocations = { builtInRoot: charactersRoot, personalRoot: personalCharactersRoot };
  let externalUiClaimed = false;
  let latestContext: ExtensionContext | undefined;

  const refreshPresentation = async (ctx: ExtensionContext): Promise<void> => {
    latestContext = ctx;
    const character = state.activeCharacter;
    const avatarMode = state.avatarMode;
    let avatar: Avatar | undefined;
    try {
      avatar = character && avatarMode !== "off" ? await loadAvatar(character) : undefined;
    } catch (error) {
      const message = error instanceof AvatarLoadError ? error.message : "Failed to load avatar";
      if (ctx.hasUI) ctx.ui.notify(message, "warning");
    }

    pi.events.emit(UI_STATE_EVENT, createUiStateSnapshot(state, locations, avatar));
    if (!ctx.hasUI) return;
    if (externalUiClaimed || !character || avatarMode === "off") {
      ctx.ui.setWidget("pi-incarnate", undefined);
      return;
    }
    if (avatar) {
      if (ctx.mode === "tui") {
        ctx.ui.setWidget("pi-incarnate", () => createAvatarWidget(character, state.currentMood, avatar, avatarMode));
      } else {
        ctx.ui.setWidget("pi-incarnate", renderAvatarWidget(character, state.currentMood, avatar, undefined, avatarMode));
      }
    } else {
      ctx.ui.setWidget("pi-incarnate", renderAvatarWidget(character, state.currentMood, undefined, undefined, avatarMode));
    }
  };

  pi.events.on(UI_CLAIM_EVENT, (payload) => {
    if (!isUiProtocolV1(payload)) return;
    externalUiClaimed = true;
    latestContext?.ui.setWidget("pi-incarnate", undefined);
  });

  pi.events.on(UI_REQUEST_STATE_EVENT, (payload) => {
    if (!isUiProtocolV1(payload) || !latestContext) return;
    void refreshPresentation(latestContext);
  });

  registerIncarnateCommand(pi, {
    charactersRoot,
    personalCharactersRoot,
    state,
    onStateChange: refreshPresentation,
  });

  pi.on("session_start", async (_event, ctx) => {
    state.reset();
    await refreshPresentation(ctx);
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
