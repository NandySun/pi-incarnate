import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  RegisteredCommand,
} from "@earendil-works/pi-coding-agent";

import incarnateExtension from "../extensions/index.ts";
import { UI_STATE_EVENT, type IncarnateUiStateV1 } from "../src/ui-protocol.ts";

test("extension wires command state into prompt and publishes presentation data", async () => {
  const handlers = new Map<string, (event: unknown, context: ExtensionCommandContext) => unknown>();
  const eventHandlers = new Map<string, Set<(data: unknown) => void>>();
  const events = {
    emit(channel: string, data: unknown) {
      for (const handler of eventHandlers.get(channel) ?? []) handler(data);
    },
    on(channel: string, handler: (data: unknown) => void) {
      const listeners = eventHandlers.get(channel) ?? new Set();
      listeners.add(handler);
      eventHandlers.set(channel, listeners);
      return () => listeners.delete(handler);
    },
  };
  const uiStates: IncarnateUiStateV1[] = [];
  events.on(UI_STATE_EVENT, (data) => uiStates.push(data as IncarnateUiStateV1));
  let command: RegisteredCommand | undefined;
  const pi = {
    events,
    on(name: string, handler: (event: unknown, context: ExtensionCommandContext) => unknown) {
      handlers.set(name, handler);
    },
    registerCommand(name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">) {
      command = {
        ...options,
        name,
        sourceInfo: { path: "test", source: "cli", scope: "temporary", origin: "top-level" },
      };
    },
  } as unknown as ExtensionAPI;
  let widgetCalls = 0;
  const context = {
    hasUI: true,
    ui: {
      notify() {},
      setWidget() {
        widgetCalls += 1;
      },
    },
  } as unknown as ExtensionCommandContext;

  incarnateExtension(pi);
  assert.ok(command);

  await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, context);
  await command.handler("use mira", context);
  const result = (await handlers.get("before_agent_start")?.(
    { type: "before_agent_start", prompt: "hello", systemPrompt: "BASE" } as BeforeAgentStartEvent,
    context,
  )) as { systemPrompt?: string };

  assert.match(result.systemPrompt ?? "", /^BASE/);
  assert.match(result.systemPrompt ?? "", /Active character: 弥拉 \(mira\)/);
  assert.match(result.systemPrompt ?? "", /Current mood preset: warm/);
  assert.match(result.systemPrompt ?? "", /3[^\n]*forms|游戏偏好:/i);
  assert.equal(uiStates.at(-1)?.character?.name, "弥拉");
  assert.equal(widgetCalls, 0);
});
