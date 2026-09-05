import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  RegisteredCommand,
} from "@earendil-works/pi-coding-agent";

import incarnateExtension from "../extensions/index.ts";
import { UI_CLAIM_EVENT, UI_STATE_EVENT, type IncarnateUiStateV1 } from "../src/ui-protocol.ts";

test("extension wires command state into prompt and widget lifecycle", async () => {
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
  const widgets: Array<string[] | undefined> = [];
  const context = {
    hasUI: true,
    ui: {
      notify() {},
      setWidget(_key: string, content: string[] | undefined) {
        widgets.push(content);
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
  assert.match(widgets.at(-1)?.[0] ?? "", /弥拉 · mood: warm/);
  assert.equal(uiStates.at(-1)?.character?.name, "弥拉");

  events.emit(UI_CLAIM_EVENT, { version: 1 });
  assert.equal(widgets.at(-1), undefined);

  await handlers.get("session_shutdown")?.({ type: "session_shutdown", reason: "quit" }, context);
  assert.equal(widgets.at(-1), undefined);
});
