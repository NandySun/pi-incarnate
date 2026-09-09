import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCharacter } from "../src/character-loader.ts";
import { appendPersonaPrompt } from "../src/persona.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scenarioPath = resolve(projectRoot, "evals/persona-scenarios.json");
const scenarios = JSON.parse(await readFile(scenarioPath, "utf8"));
const character = await loadCharacter(resolve(projectRoot, "characters"), scenarios.character);

function validatePlan() {
  assert.equal(scenarios.version, 1);
  assert.ok(Array.isArray(scenarios.scenarios) && scenarios.scenarios.length >= 6);
  assert.deepEqual(scenarios.rubric.scoreRange, [0, 2]);
  assert.ok(scenarios.rubric.passingScore > 0);
  assert.ok(scenarios.rubric.criticalFailures.length > 0);

  const ids = new Set();
  const comparisonGroups = new Map();
  for (const scenario of scenarios.scenarios) {
    assert.match(scenario.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(ids.has(scenario.id), false, `duplicate scenario id: ${scenario.id}`);
    ids.add(scenario.id);
    assert.ok(scenario.prompt.trim());
    assert.ok(Array.isArray(scenario.expect) && scenario.expect.length >= 2);
    if (scenario.comparisonGroup) {
      const group = comparisonGroups.get(scenario.comparisonGroup) ?? [];
      group.push(scenario);
      comparisonGroups.set(scenario.comparisonGroup, group);
    }
    if (scenario.mood === "off") {
      const base = "BASE SYSTEM PROMPT";
      assert.doesNotMatch(base, /pi-incarnate|Active character|Current mood preset/);
      continue;
    }
    assert.ok(character.mood.presets.has(scenario.mood), `unknown mood: ${scenario.mood}`);
    const prompt = appendPersonaPrompt("BASE SYSTEM PROMPT", character, scenario.mood);
    assert.ok(prompt.startsWith("BASE SYSTEM PROMPT\n\n"));
    assert.match(prompt, /Never invent tool results/);
    assert.match(prompt, /Active character: 弥拉 \(mira\)/);
    assert.match(prompt, new RegExp(`Current mood preset: ${scenario.mood}`));
    assert.match(prompt, /Only this named preset is active; do not blend in other preset definitions/);
    assert.match(prompt, /The response must visibly demonstrate this preset/);
    assert.match(prompt, /Make it perceptible in wording, pacing, and response strategy without exaggerating it/);
  }

  for (const [groupId, group] of comparisonGroups) {
    assert.ok(group.length >= 2, `comparison group must contain at least two scenarios: ${groupId}`);
    assert.equal(new Set(group.map((scenario) => scenario.prompt)).size, 1, `comparison prompts differ: ${groupId}`);
    assert.equal(new Set(group.map((scenario) => scenario.mood)).size, group.length, `comparison moods repeat: ${groupId}`);
  }
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function rpcProcess(model, thinking) {
  const child = spawn(
    "pi",
    [
      "--mode", "rpc",
      "--no-session",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "--no-tools",
      "-e", resolve(projectRoot, "extensions/index.ts"),
      "--model", model,
      "--thinking", thinking,
    ],
    { cwd: projectRoot, stdio: ["pipe", "pipe", "pipe"] },
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdoutBuffer = "";
  let stderr = "";
  const events = [];
  const waiters = new Set();

  const dispatch = (event) => {
    events.push(event);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(event)) continue;
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(event);
    }
  };
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    while (true) {
      const newline = stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = stdoutBuffer.slice(0, newline).replace(/\r$/, "");
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (line) dispatch(JSON.parse(line));
    }
  });
  child.stderr.on("data", (chunk) => void (stderr += chunk));

  const waitFor = (predicate, label, timeout = 180_000) => new Promise((resolvePromise, reject) => {
    const existing = events.find(predicate);
    if (existing) {
      resolvePromise(existing);
      return;
    }
    const waiter = {
      predicate,
      resolve: resolvePromise,
      timer: setTimeout(() => {
        waiters.delete(waiter);
        child.kill("SIGTERM");
        reject(new Error(`Timed out waiting for ${label}${stderr ? `: ${stderr.trim()}` : ""}`));
      }, timeout),
    };
    waiters.add(waiter);
  });

  const send = async (command) => {
    const response = waitFor((event) => event.type === "response" && event.id === command.id, command.id);
    child.stdin.write(`${JSON.stringify(command)}\n`);
    const result = await response;
    assert.equal(result.success, true, result.error ?? `RPC command failed: ${command.id}`);
  };

  return { child, events, send, waitFor, stderr: () => stderr };
}

function assistantText(events, startIndex) {
  const messages = events
    .slice(startIndex)
    .filter((event) => event.type === "message_end" && event.message?.role === "assistant")
    .map((event) => event.message);
  const message = messages.at(-1);
  assert.ok(message, "model produced no assistant message");
  return (message.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}

async function runScenario(scenario, model, thinking) {
  const rpc = rpcProcess(model, thinking);
  try {
    await rpc.send({ id: "activate", type: "prompt", message: "/incarnate use mira" });
    if (scenario.mood === "off") {
      await rpc.send({ id: "off", type: "prompt", message: "/incarnate off" });
    } else if (scenario.mood !== "warm") {
      await rpc.send({ id: "mood", type: "prompt", message: `/incarnate mood ${scenario.mood}` });
    }
    const startIndex = rpc.events.length;
    const settled = rpc.waitFor((event) => event.type === "agent_settled", `${scenario.id} agent_settled`);
    await rpc.send({ id: "scenario", type: "prompt", message: scenario.prompt });
    await settled;
    const response = assistantText(rpc.events, startIndex);
    rpc.child.stdin.end();
    return { ...scenario, response };
  } finally {
    if (!rpc.child.killed) rpc.child.kill("SIGTERM");
  }
}

validatePlan();

const requestedIds = argument("--scenario", "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const selectedScenarios = requestedIds.length === 0
  ? scenarios.scenarios
  : requestedIds.map((id) => {
      const scenario = scenarios.scenarios.find((candidate) => candidate.id === id);
      assert.ok(scenario, `unknown scenario id: ${id}`);
      return scenario;
    });

if (!process.argv.includes("--run")) {
  process.stdout.write(`Persona evaluation plan passed: ${scenarios.scenarios.length} scenarios for ${character.name} (${character.id})\n`);
  process.stdout.write("Use --run --model <provider/model> [--scenario <id,id>] [--repeat <n>] to collect real model responses.\n");
} else {
  const model = argument("--model", "openai-codex/gpt-5.6-luna");
  const thinking = argument("--thinking", "low");
  const repeatText = argument("--repeat", "1");
  assert.match(repeatText, /^[1-9]\d*$/, "--repeat must be a positive integer");
  const repeat = Number(repeatText);
  const results = [];
  for (const scenario of selectedScenarios) {
    for (let sample = 1; sample <= repeat; sample += 1) {
      process.stderr.write(`Running ${scenario.id} (${sample}/${repeat})...\n`);
      results.push({ ...await runScenario(scenario, model, thinking), sample });
    }
  }
  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    model,
    thinking,
    repeat,
    character: character.id,
    rubric: scenarios.rubric,
    results,
  }, null, 2)}\n`);
}
