import assert from "node:assert/strict";
import { accessSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";

import {
  UI_REQUEST_STATE_EVENT,
  UI_STATE_EVENT,
} from "../src/ui-protocol.ts";

const agentRoot = mkdtempSync(join(tmpdir(), "pi-incarnate-companion-"));
const personalCharacterRoot = join(agentRoot, "pi-incarnate", "characters", "example");
const pngCharacterRoot = join(agentRoot, "pi-incarnate", "characters", "png-example");
mkdirSync(personalCharacterRoot, { recursive: true });
writeFileSync(
  join(personalCharacterRoot, "CHARACTER.md"),
  `# Example Character

## Identity
Integration fixture.

## Personality
Steady and observant.

## Speech Style
Concise.

## Behavior
Honest about uncertainty.

## Current Mood
Default: calm

### calm
Use an even tone.

### focused
Lead with the result.
`,
);
writeFileSync(join(personalCharacterRoot, "avatar.txt"), "EXAMPLE");
mkdirSync(pngCharacterRoot, { recursive: true });
writeFileSync(
  join(pngCharacterRoot, "CHARACTER.md"),
  `# PNG Example

## Identity
PNG integration fixture.

## Personality
Steady and observant.

## Speech Style
Concise.

## Behavior
Honest about uncertainty.

## Current Mood
Default: calm

### calm
Use an even tone.
`,
);
writeFileSync(
  join(pngCharacterRoot, "avatar.png"),
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);
writeFileSync(join(pngCharacterRoot, "avatar.txt"), "PNG-FALLBACK");
process.env.PI_CODING_AGENT_DIR = agentRoot;
after(() => rmSync(agentRoot, { recursive: true, force: true }));

const companionRoot = resolve(
  process.env.PI_INCARNATE_UI_ROOT ?? new URL("../../pi-incarnate-ui", import.meta.url).pathname,
);
const companionEntry = resolve(companionRoot, "extensions/index.ts");
const companionProtocol = resolve(companionRoot, "src/protocol.ts");

try {
  accessSync(companionEntry);
  accessSync(companionProtocol);
} catch {
  throw new Error(
    `pi-incarnate-ui source is required for the companion integration gate. Expected: ${companionRoot}`,
  );
}

const [{ default: incarnateExtension }, { default: incarnateUiExtension }, uiProtocol] = await Promise.all([
  import(new URL("../extensions/index.ts", import.meta.url).href),
  import(pathToFileURL(companionEntry).href),
  import(pathToFileURL(companionProtocol).href),
]);

function eventBus() {
  const listeners = new Map();
  return {
    emit(channel, payload) {
      for (const listener of listeners.get(channel) ?? []) listener(payload);
    },
    on(channel, listener) {
      const channelListeners = listeners.get(channel) ?? new Set();
      channelListeners.add(listener);
      listeners.set(channel, channelListeners);
      return () => channelListeners.delete(listener);
    },
  };
}

function createHarness(order) {
  const events = eventBus();
  const handlers = new Map();
  const commands = new Map();
  const notifications = [];
  const states = [];
  let footerComponent;
  let footerInstalls = 0;
  let footerClears = 0;
  let renders = 0;
  let stateRequests = 0;

  events.on(UI_STATE_EVENT, (payload) => states.push(payload));
  events.on(UI_REQUEST_STATE_EVENT, () => void (stateRequests += 1));

  const tui = {
    terminal: { rows: 24 },
    requestRender() {
      renders += 1;
    },
  };
  const theme = {
    fg: (_color, value) => value,
    bold: (value) => `\u001b[1m${value}\u001b[22m`,
  };
  const footerData = {
    getGitBranch: () => "main",
    getExtensionStatuses: () => new Map([["example", "ready"]]),
    getAvailableProviderCount: () => 1,
    onBranchChange: () => () => {},
  };
  const context = {
    mode: "tui",
    hasUI: true,
    model: { id: "gpt-example", provider: "openai", reasoning: true, contextWindow: 100_000 },
    thinkingLevel: "medium",
    cwd: "/workspace/example-project",
    getContextUsage: () => ({ tokens: 2_000, contextWindow: 100_000, percent: 2 }),
    sessionManager: { getEntries: () => [], getSessionName: () => "Integration Session" },
    ui: {
      notify(message, type) {
        notifications.push({ message, type });
      },
      setFooter(factory) {
        footerComponent?.dispose?.();
        footerComponent = undefined;
        if (factory) {
          footerInstalls += 1;
          footerComponent = factory(tui, theme, footerData);
        } else {
          footerClears += 1;
        }
      },
      async custom() {},
    },
  };
  const pi = {
    events,
    on(name, handler) {
      const eventHandlers = handlers.get(name) ?? [];
      eventHandlers.push(handler);
      handlers.set(name, eventHandlers);
    },
    registerCommand(name, command) {
      assert.equal(commands.has(name), false, `duplicate command: ${name}`);
      commands.set(name, command);
    },
  };

  for (const extension of order) {
    if (extension === "core") incarnateExtension(pi);
    if (extension === "ui") incarnateUiExtension(pi);
  }

  return {
    events,
    commands,
    context,
    notifications,
    states,
    async trigger(name, event = { type: name }) {
      for (const handler of handlers.get(name) ?? []) await handler(event, context);
    },
    async command(name, args) {
      const registered = commands.get(name);
      assert.ok(registered, `missing command: ${name}`);
      await registered.handler(args, context);
    },
    render(width = 80) {
      return footerComponent?.render(width) ?? [];
    },
    metrics() {
      return { footerInstalls, footerClears, renders, stateRequests };
    },
  };
}

test("core and companion export the same v1 channel names", () => {
  assert.equal(uiProtocol.UI_REQUEST_STATE_EVENT, UI_REQUEST_STATE_EVENT);
  assert.equal(uiProtocol.UI_STATE_EVENT, UI_STATE_EVENT);
  assert.equal("UI_CLAIM_EVENT" in uiProtocol, false);
});

for (const order of [
  ["core", "ui"],
  ["ui", "core"],
]) {
  test(`real extensions stay synchronized when loaded ${order.join(" then ")}`, async () => {
    const harness = createHarness(order);
    await harness.trigger("session_start", { type: "session_start", reason: "startup" });

    assert.equal(harness.metrics().stateRequests, 1);
    assert.equal(harness.metrics().footerInstalls, 0);
    assert.deepEqual(harness.render(), []);

    await harness.command("incarnate", "use mira");
    assert.equal(harness.metrics().footerInstalls, 1);
    assert.match(harness.render().join("\n"), /弥拉/);
    assert.match(harness.render().join("\n"), /warm/);

    const activeState = harness.states.at(-1);
    assert.equal(uiProtocol.isIncarnateUiStateV1(activeState), true);
    assert.deepEqual(Object.keys(activeState).sort(), ["active", "avatar", "avatarMode", "character", "version"]);
    assert.deepEqual(Object.keys(activeState.character).sort(), ["forms", "id", "mood", "name", "source"]);
    assert.doesNotMatch(JSON.stringify(activeState), /cardPath|markdown|CHARACTER\.md|\/home\//);

    const rendersBeforeMood = harness.metrics().renders;
    await harness.command("incarnate", "mood focused");
    assert.ok(harness.metrics().renders > rendersBeforeMood);
    assert.match(harness.render().join("\n"), /focused/);

    await harness.command("incarnate", "use example");
    assert.equal(harness.metrics().footerInstalls, 1);
    assert.match(harness.render().join("\n"), /Example Character/);
    assert.match(harness.render().join("\n"), /calm/);
    assert.equal(harness.states.at(-1).character.source, "personal");

    await harness.command("incarnate", "use png-example");
    const pngState = harness.states.at(-1);
    assert.equal(uiProtocol.isIncarnateUiStateV1(pngState), true);
    assert.equal(pngState.character.id, "png-example");
    assert.deepEqual(pngState.avatar.lines, ["PNG-FALLBACK"]);
    assert.deepEqual(
      {
        mimeType: pngState.avatar.image.mimeType,
        widthPx: pngState.avatar.image.widthPx,
        heightPx: pngState.avatar.image.heightPx,
        bytes: pngState.avatar.image.bytes,
      },
      { mimeType: "image/png", widthPx: 1, heightPx: 1, bytes: 68 },
    );
    assert.equal(Buffer.from(pngState.avatar.image.data, "base64").byteLength, 68);
    assert.doesNotMatch(JSON.stringify(pngState), /cardPath|markdown|CHARACTER\.md|\/home\//);

    await harness.command("incarnate", "avatar compact");
    assert.equal(harness.render().length, 3);

    const metricsBeforeUnknown = harness.metrics();
    harness.events.emit(UI_STATE_EVENT, { version: 2, active: false, avatarMode: "off" });
    assert.deepEqual(harness.metrics(), metricsBeforeUnknown);
    assert.match(harness.render().join("\n"), /PNG Example/);

    await harness.command("incarnate", "avatar off");
    assert.equal(harness.metrics().footerClears, 1);
    assert.deepEqual(harness.render(), []);

    await harness.command("incarnate", "avatar full");
    assert.equal(harness.metrics().footerInstalls, 2);
    assert.match(harness.render().join("\n"), /calm/);

    await harness.command("incarnate", "off");
    assert.equal(harness.metrics().footerClears, 2);
    assert.equal(harness.states.at(-1).active, false);

    await harness.trigger("session_shutdown", { type: "session_shutdown", reason: "quit" });
    assert.deepEqual(harness.render(), []);

    const restarted = createHarness(order);
    await restarted.trigger("session_start", { type: "session_start", reason: "new" });
    assert.equal(restarted.states.at(-1).active, false);
    assert.equal(restarted.metrics().footerInstalls, 0);
  });
}

test("core remains functional without the companion UI", async () => {
  const harness = createHarness(["core"]);
  await harness.trigger("session_start", { type: "session_start", reason: "startup" });
  await harness.command("incarnate", "use mira");

  assert.equal(harness.metrics().footerInstalls, 0);
  assert.equal(harness.states.at(-1).active, true);
  assert.match(harness.notifications.at(-1).message, /Character enabled/);
});

test("companion leaves the default Footer untouched without a core response", async () => {
  const harness = createHarness(["ui"]);
  await harness.trigger("session_start", { type: "session_start", reason: "startup" });
  harness.events.emit(UI_STATE_EVENT, { version: 99, active: true, avatarMode: "full" });

  assert.deepEqual(harness.metrics(), {
    footerInstalls: 0,
    footerClears: 0,
    renders: 0,
    stateRequests: 1,
  });
  assert.deepEqual(harness.render(), []);
});
