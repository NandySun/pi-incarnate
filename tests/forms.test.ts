import assert from "node:assert/strict";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseFormDeclarations, resolveFormReferences } from "../src/forms.ts";

const CARD = `# Mira

## Tools and Forms
- Games: \`forms/games.md\`
- Missing: \`forms/missing.md\`
- Escape: \`../secret.md\`
- Absolute: \`/etc/passwd\`
`;

test("parses only explicitly declared form bullets", () => {
  const declarations = parseFormDeclarations(`${CARD}\nThis mentions forms/ignored.md but does not declare it.`);
  assert.equal(declarations.length, 4);
  assert.equal(declarations[0].declaredPath, "forms/games.md");
});

test("resolves available forms and rejects missing or escaping paths", async (t) => {
  const parent = join(tmpdir(), `pi-incarnate-forms-${crypto.randomUUID()}`);
  const characterDirectory = join(parent, "mira");
  await mkdir(join(characterDirectory, "forms"), { recursive: true });
  await writeFile(join(characterDirectory, "forms", "games.md"), "# Games\n");
  await writeFile(join(parent, "secret.md"), "secret");
  t.after(() => rm(parent, { recursive: true, force: true }));

  const forms = await resolveFormReferences(characterDirectory, CARD);

  assert.deepEqual(forms.map((form) => form.status), ["available", "missing", "invalid", "invalid"]);
});

test("rejects a symlink that resolves outside the character directory", async (t) => {
  const parent = join(tmpdir(), `pi-incarnate-forms-${crypto.randomUUID()}`);
  const characterDirectory = join(parent, "mira");
  await mkdir(join(characterDirectory, "forms"), { recursive: true });
  await writeFile(join(parent, "outside.md"), "outside");
  await symlink(join(parent, "outside.md"), join(characterDirectory, "forms", "linked.md"));
  t.after(() => rm(parent, { recursive: true, force: true }));

  const forms = await resolveFormReferences(
    characterDirectory,
    "## Tools and Forms\n- Linked: `forms/linked.md`",
  );

  assert.equal(forms[0].status, "invalid");
  assert.match(forms[0].reason ?? "", /escapes/);
});
