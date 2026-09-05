import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeAnsiAvatar } from "../src/avatar.ts";
import type { Character } from "../src/character-loader.ts";
import { IncarnateSessionState } from "../src/session-state.ts";
import { createUiStateSnapshot, isUiProtocolV1 } from "../src/ui-protocol.ts";

const character: Character = {
  id: "seed",
  name: "席德",
  cardPath: "/personal/seed/CHARACTER.md",
  directory: "/personal/seed",
  markdown: "# 席德",
  sections: {
    Identity: "identity",
    Personality: "personality",
    "Speech Style": "speech",
    Behavior: "behavior",
  },
  forms: [
    { label: "available", declaredPath: "forms/a.md", status: "available", resolvedPath: "/personal/seed/forms/a.md" },
    { label: "missing", declaredPath: "forms/b.md", status: "missing", reason: "missing" },
  ],
  mood: { defaultPreset: "normal", presets: new Map([["normal", { id: "normal", instruction: "calm" }]]) },
};

test("creates a bounded read-only UI snapshot for an active character", () => {
  const state = new IncarnateSessionState();
  state.activate(character);
  const avatar = sanitizeAnsiAvatar("\u001b[31m席德\u001b[0m");

  const snapshot = createUiStateSnapshot(
    state,
    { builtInRoot: "/built-in", personalRoot: "/personal" },
    avatar,
  );

  assert.equal(snapshot.active, true);
  assert.equal(snapshot.character?.source, "personal");
  assert.deepEqual(snapshot.character?.forms, { available: 1, total: 2 });
  assert.equal(snapshot.avatar?.width, 4);
  assert.equal(snapshot.avatar?.height, 1);
  assert.match(snapshot.avatar?.lines[0] ?? "", /\u001b\[31m/);
  assert.equal("rawCard" in (snapshot.character ?? {}), false);
});

test("inactive snapshots contain no character or avatar data", () => {
  const snapshot = createUiStateSnapshot(
    new IncarnateSessionState(),
    { builtInRoot: "/built-in", personalRoot: "/personal" },
    sanitizeAnsiAvatar("avatar"),
  );

  assert.deepEqual(snapshot, { version: 1, active: false, avatarMode: "auto" });
});

test("recognizes only the v1 protocol envelope", () => {
  assert.equal(isUiProtocolV1({ version: 1 }), true);
  assert.equal(isUiProtocolV1({ version: 2 }), false);
  assert.equal(isUiProtocolV1(null), false);
});
