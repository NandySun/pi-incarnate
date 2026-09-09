import assert from "node:assert/strict";
import { test } from "node:test";

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { confirmMenu, selectMenu } from "../src/select-menu.ts";

const COLORS: Record<string, number> = {
  accent: 96,
  muted: 90,
  warning: 93,
};

function themedContext(rendered: string[][]): ExtensionCommandContext {
  const theme = {
    bold: (text: string) => `\u001b[1m${text}\u001b[22m`,
    fg: (color: string, text: string) => `\u001b[${COLORS[color] ?? 39}m${text}\u001b[39m`,
  };
  const tui = { requestRender() {} };
  return {
    ui: {
      theme,
      async custom(factory: (...args: any[]) => any) {
        let completed = false;
        let result: unknown;
        const component = await factory(tui, theme, {}, (value: unknown) => {
          completed = true;
          result = value;
        });
        rendered.push(component.render(80));
        component.handleInput("\r");
        assert.equal(completed, true);
        return result;
      },
    },
  } as unknown as ExtensionCommandContext;
}

test("themed menu keeps unselected options on the bold terminal foreground", async () => {
  const rendered: string[][] = [];
  const selected = await selectMenu(themedContext(rendered), "Readable menu", ["First", "Second"]);

  assert.equal(selected, "First");
  assert.ok(rendered[0]!.some((line) => line.includes("\u001b[96m→ First")), "selected option should use accent");
  assert.ok(rendered[0]!.some((line) => line.includes("\u001b[1mSecond\u001b[22m")), "unselected option should be bold");
  assert.ok(!rendered[0]!.some((line) => line.includes("\u001b[97mSecond")), "unselected option should not force a foreground color");
});

test("themed confirmation keeps the same readable option treatment", async () => {
  const rendered: string[][] = [];
  assert.equal(await confirmMenu(themedContext(rendered), "Continue?", "Review this action."), true);
  assert.ok(rendered[0]!.some((line) => line.includes("\u001b[1mNo\u001b[22m")));
});
