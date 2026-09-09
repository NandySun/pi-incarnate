import assert from "node:assert/strict";
import { test } from "node:test";

import { removeLevelTwoSection } from "../src/markdown.ts";

test("removes a named level-two section while preserving surrounding content", () => {
  const markdown = "# Mira\n\n## Identity\nArchivist\n\n## Current Mood\nDefault: warm\n\n### warm\nBe patient.\n\n## Notes\nKeep me.";
  const result = removeLevelTwoSection(markdown, "current mood");
  assert.equal(result, "# Mira\n\n## Identity\nArchivist\n\n## Notes\nKeep me.");
});

test("ignores pseudo-headings inside fenced code blocks", () => {
  const markdown = "# Mira\n\n## Notes\n```md\n## Current Mood\nnot configuration\n```";
  assert.equal(removeLevelTwoSection(markdown, "Current Mood"), markdown);
});

test("returns cards without the requested section unchanged", () => {
  const markdown = "# Mira\n\n## Identity\nArchivist";
  assert.equal(removeLevelTwoSection(markdown, "Current Mood"), markdown);
});
