import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { sanitizeAvatar } from "../src/avatar.ts";

test("removes terminal control sequences and expands tabs", () => {
  const avatar = sanitizeAvatar("\u001b[31mred\u001b[0m\tface\u0007");
  assert.deepEqual(avatar.lines, ["red    face"]);
});

test("limits avatar display columns and line count", () => {
  const avatar = sanitizeAvatar(["界".repeat(30), ...Array.from({ length: 15 }, (_, index) => `line ${index}`)].join("\n"));
  assert.equal(avatar.lines.length, 12);
  assert.ok(avatar.lines.every((line) => visibleWidth(line) <= 48));
  assert.equal(avatar.truncated, true);
});
