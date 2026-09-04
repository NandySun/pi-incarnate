import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "pi-incarnate-package-"));

try {
  const rawPackResult = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temporaryDirectory], {
      encoding: "utf8",
    }),
  );
  const packResult = Array.isArray(rawPackResult) ? rawPackResult : Object.values(rawPackResult);
  assert.equal(packResult.length, 1, "npm pack should create exactly one tarball");

  const archivePath = join(temporaryDirectory, packResult[0].filename);
  const extractDirectory = join(temporaryDirectory, "extract");
  mkdirSync(extractDirectory);
  execFileSync("tar", ["-xzf", archivePath, "-C", extractDirectory]);

  const rpc = spawnSync(
    "pi",
    [
      "--mode",
      "rpc",
      "--offline",
      "--no-session",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "-e",
      join(extractDirectory, "package"),
    ],
    {
      encoding: "utf8",
      input: '{"id":"commands","type":"get_commands"}\n',
      timeout: 15_000,
    },
  );

  assert.equal(rpc.error, undefined, rpc.error?.message);
  assert.equal(rpc.status, 0, rpc.stderr || "Pi package smoke process failed");
  const messages = rpc.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const response = messages.find((message) => message.id === "commands");
  assert.equal(response?.success, true, "Pi get_commands request should succeed");
  assert.ok(
    response.data.commands.some((command) => command.name === "incarnate" && command.source === "extension"),
    "packed extension should register /incarnate",
  );
  process.stdout.write(`Packed Pi extension smoke passed (${packResult[0].entryCount} files)\n`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
