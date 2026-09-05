import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import {
  characterSource,
  discoverCharacterCatalog,
  loadCatalogCharacter,
  type CharacterLocations,
} from "./character-catalog.ts";
import { CharacterLoadError } from "./character-loader.ts";
import { openIncarnateMenu } from "./menu.ts";
import type { AvatarMode } from "./session-state.ts";
import type { IncarnateSessionState } from "./session-state.ts";

export interface IncarnateCommandDependencies {
  charactersRoot: string;
  personalCharactersRoot?: string;
  state: IncarnateSessionState;
  onStateChange?: (ctx: ExtensionCommandContext) => Promise<void> | void;
}

const USAGE =
  "Usage: /incarnate list | use <character-id> | off | status | mood <preset> | avatar auto|full|compact|off";

function notifyError(ctx: ExtensionCommandContext, message: string): void {
  ctx.ui.notify(message, "error");
}

export function registerIncarnateCommand(pi: ExtensionAPI, dependencies: IncarnateCommandDependencies): void {
  const { charactersRoot, personalCharactersRoot, state, onStateChange } = dependencies;
  const locations: CharacterLocations = { builtInRoot: charactersRoot, personalRoot: personalCharactersRoot };

  pi.registerCommand("incarnate", {
    description: "Open the character menu or manage personas with subcommands",
    getArgumentCompletions: async (prefix) => {
      const [subcommand = "", argument = ""] = prefix.trimStart().split(/\s+/, 2);
      if (!prefix.trimStart().includes(" ")) {
        return ["list", "use", "off", "status", "mood", "avatar"]
          .filter((value) => value.startsWith(subcommand))
          .map((value) => ({ value, label: value }));
      }
      if (subcommand === "avatar") {
        const matches = ["auto", "full", "compact", "off", "on"]
          .filter((value) => value.startsWith(argument))
          .map((value) => ({ value: `avatar ${value}`, label: value }));
        return matches.length > 0 ? matches : null;
      }
      if (subcommand === "mood") {
        const matches = [...(state.activeCharacter?.mood.presets.values() ?? [])]
          .filter((preset) => preset.id.startsWith(argument))
          .map((preset) => ({ value: `mood ${preset.id}`, label: preset.id }));
        return matches.length > 0 ? matches : null;
      }
      if (subcommand !== "use") return null;
      const { entries } = await discoverCharacterCatalog(locations);
      const matches = entries
        .filter(({ character }) => character.id.startsWith(argument))
        .map(({ character }) => ({ value: `use ${character.id}`, label: character.id, description: character.name }));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      const [subcommand = "", id, ...extra] = args.trim().split(/\s+/).filter(Boolean);

      if (!subcommand) {
        if (ctx.hasUI) {
          await openIncarnateMenu(ctx, { locations, state, onStateChange });
        } else {
          ctx.ui.notify(USAGE, "info");
        }
        return;
      }

      if (subcommand === "list" && !id) {
        const { entries, issues } = await discoverCharacterCatalog(locations);
        if (entries.length === 0) {
          ctx.ui.notify("No valid characters found", "warning");
        } else {
          const list = entries
            .map(({ character, source }) => `${character.id} — ${character.name}${state.activeCharacter?.id === character.id ? " (active)" : ""} [${source}]`)
            .join("\n");
          ctx.ui.notify(list, "info");
        }
        if (issues.length > 0) {
          ctx.ui.notify(`${issues.length} invalid character director${issues.length === 1 ? "y" : "ies"} ignored`, "warning");
        }
        return;
      }

      if (subcommand === "use" && id && extra.length === 0) {
        try {
          const { character } = await loadCatalogCharacter(locations, id);
          state.activate(character);
          await onStateChange?.(ctx);
          ctx.ui.notify(`Character enabled: ${character.name} (${character.id})`, "info");
        } catch (error) {
          const message = error instanceof CharacterLoadError ? error.message : `Failed to load character: ${id}`;
          notifyError(ctx, message);
        }
        return;
      }

      if (subcommand === "off" && !id) {
        const previous = state.activeCharacter;
        state.deactivate();
        await onStateChange?.(ctx);
        ctx.ui.notify(previous ? `Character disabled: ${previous.name}` : "Character mode is already off", "info");
        return;
      }

      if (subcommand === "status" && !id) {
        const active = state.activeCharacter;
        ctx.ui.notify(
          active
            ? `Active character: ${active.name} (${active.id})\nSource: ${characterSource(active, locations)}\nMood: ${state.currentMood ?? "none"}\nAvatar: ${state.avatarMode}\nForms: ${active.forms.filter((form) => form.status === "available").length}/${active.forms.length} available\nCard: ${active.cardPath}`
            : `Character mode: off\nAvatar: ${state.avatarMode}`,
          "info",
        );
        return;
      }

      if (subcommand === "mood" && id && extra.length === 0) {
        const active = state.activeCharacter;
        if (!active) {
          notifyError(ctx, "Enable a character before selecting a mood");
          return;
        }
        if (!active.mood.presets.has(id)) {
          const available = [...active.mood.presets.keys()].join(", ") || "none";
          notifyError(ctx, `Unknown mood '${id}'. Available: ${available}`);
          return;
        }
        state.setMood(id);
        await onStateChange?.(ctx);
        ctx.ui.notify(`Mood changed: ${id}`, "info");
        return;
      }

      if (
        subcommand === "avatar" &&
        id &&
        ["auto", "full", "compact", "off", "on"].includes(id) &&
        extra.length === 0
      ) {
        const mode: AvatarMode = id === "on" ? "auto" : (id as AvatarMode);
        state.setAvatarMode(mode);
        await onStateChange?.(ctx);
        ctx.ui.notify(`Avatar: ${mode}`, "info");
        return;
      }

      notifyError(ctx, USAGE);
    },
  });
}
