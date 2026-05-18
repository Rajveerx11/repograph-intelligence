import { execFile } from "node:child_process";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { GitHubClient } from "./github-client.js";
import {
  apiDiffSection,
  driftSection,
  isRepoGraphComment,
  policySection,
  renderComment,
  testSelectionSection
} from "./formatters.js";

const execFileAsync = promisify(execFile);
const REPOGRAPH_CLI_TIMEOUT_MS = 5 * 60 * 1000;
const REPOGRAPH_CLI_MAX_BUFFER = 50 * 1024 * 1024;

main().catch((error) => {
  console.error(`::error::RepoGraph action crashed: ${error.message}`);
  process.exit(1);
});

async function main() {
  const env = process.env;
  const workspace = env.GITHUB_WORKSPACE ?? process.cwd();
  const eventName = env.GITHUB_EVENT_NAME ?? "";
  const eventPath = env.GITHUB_EVENT_PATH;
  if (eventName !== "pull_request" && eventName !== "pull_request_target") {
    console.log("::notice::RepoGraph action skipped — only runs on `pull_request` or `pull_request_target` events.");
    return;
  }
  if (!eventPath || !existsSync(eventPath)) {
    throw new Error("GITHUB_EVENT_PATH not available — cannot resolve PR metadata.");
  }
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const pullRequest = event.pull_request;
  if (!pullRequest) {
    throw new Error("Event payload has no `pull_request` block.");
  }

  const [owner, repo] = (env.GITHUB_REPOSITORY ?? "").split("/");
  if (!owner || !repo) {
    throw new Error("GITHUB_REPOSITORY is not set.");
  }

  const policyPath = (env.REPOGRAPH_POLICY_PATH ?? "").trim();
  const baselinePath = (env.REPOGRAPH_BASELINE_PATH ?? "").trim();
  const baseGraphPath = (env.REPOGRAPH_BASE_GRAPH_PATH ?? "").trim();
  const failOnPolicy = parseBool(env.REPOGRAPH_FAIL_ON_POLICY, true);
  const failOnBreaking = parseBool(env.REPOGRAPH_FAIL_ON_BREAKING, true);
  const failOnDrift = parseBool(env.REPOGRAPH_FAIL_ON_DRIFT, true);
  const commentMode = (env.REPOGRAPH_COMMENT_MODE ?? "update").trim() === "append" ? "append" : "update";

  // Always analyze the head state of the PR so api-diff / test-select
  // have something to chew on. Save the graph at a deterministic path
  // so subsequent gate commands reuse it instead of re-walking the
  // tree.
  const headGraphPath = path.join(workspace, ".repograph", "graph.json");
  await runCli(workspace, ["analyze", workspace, "--out", headGraphPath]);

  const changedFiles = (env.REPOGRAPH_CHANGED_FILES ?? "").trim() || (await detectChangedFiles(workspace, pullRequest));

  const gates = [];
  const failures = [];

  if (policyPath && existsSync(path.resolve(workspace, policyPath))) {
    const safePolicyPath = ensureInsideWorkspace(workspace, policyPath, "policy-path");
    const report = await runCliJson(workspace, ["policy", workspace, "--policy", safePolicyPath, "--graph", headGraphPath, "--json"], [2]);
    const section = policySection(report);
    if (section) {
      gates.push(section);
      if (!section.passed && failOnPolicy) {
        failures.push("policy");
      }
    }
  } else if (policyPath) {
    console.log(`::notice::Policy file ${policyPath} not found — skipping policy gate.`);
  }

  if (baseGraphPath && existsSync(path.resolve(workspace, baseGraphPath))) {
    const safeBase = ensureInsideWorkspace(workspace, baseGraphPath, "base-graph-path");
    const report = await runCliJson(workspace, ["api-diff", "--base", safeBase, "--head", headGraphPath, "--json"], [3]);
    const section = apiDiffSection(report);
    if (section) {
      gates.push(section);
      if (!section.passed && failOnBreaking) {
        failures.push("api-diff");
      }
    }
  } else if (baseGraphPath) {
    console.log(`::notice::Base graph ${baseGraphPath} not found — skipping api-diff gate.`);
  }

  if (baselinePath && existsSync(path.resolve(workspace, baselinePath))) {
    const safeBaseline = ensureInsideWorkspace(workspace, baselinePath, "baseline-path");
    const report = await runCliJson(workspace, ["drift", workspace, "--baseline", safeBaseline, "--graph", headGraphPath, "--json"], [4]);
    const section = driftSection(report);
    if (section) {
      gates.push(section);
      if (!section.passed && failOnDrift) {
        failures.push("drift");
      }
    }
  } else if (baselinePath) {
    console.log(`::notice::Baseline ${baselinePath} not found — skipping drift gate.`);
  }

  if (changedFiles) {
    const report = await runCliJson(
      workspace,
      ["test-select", workspace, "--changed", changedFiles, "--graph", headGraphPath, "--json"]
    );
    const section = testSelectionSection(report);
    if (section) {
      gates.push(section);
    }
  } else {
    console.log("::notice::No changed files detected — skipping test-selection.");
  }

  const verdict = failures.length === 0 ? "pass" : "fail";
  const comment = renderComment({
    overall: { passed: failures.length === 0, failedGates: failures, generatedAt: new Date().toISOString() },
    gates
  });

  const client = new GitHubClient({ token: env.GH_TOKEN ?? env.GITHUB_TOKEN ?? "", owner, repo });
  let commentUrl = "";
  try {
    if (commentMode === "update") {
      const existing = await client.listIssueComments(pullRequest.number);
      const sticky = existing.find((entry) => isRepoGraphComment(entry.body ?? ""));
      if (sticky) {
        const result = await client.updateIssueComment(sticky.id, comment);
        commentUrl = result.html_url ?? "";
      } else {
        const result = await client.createIssueComment(pullRequest.number, comment);
        commentUrl = result.html_url ?? "";
      }
    } else {
      const result = await client.createIssueComment(pullRequest.number, comment);
      commentUrl = result.html_url ?? "";
    }
  } catch (error) {
    console.log(`::warning::Posting PR comment failed: ${error.message}`);
  }

  writeOutputs({ verdict, "comment-url": commentUrl });
  console.log(comment);

  if (failures.length > 0) {
    console.log(`::error::RepoGraph gates failed: ${failures.join(", ")}`);
    process.exit(failures.includes("policy") ? 2 : failures.includes("api-diff") ? 3 : 4);
  }
}

function parseBool(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  const normalised = String(value).trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalised)) {
    return true;
  }
  if (["false", "0", "no"].includes(normalised)) {
    return false;
  }
  return fallback;
}

function ensureInsideWorkspace(workspace, candidate, label) {
  if (path.isAbsolute(candidate)) {
    throw new Error(`${label} must be a workspace-relative path; got an absolute path.`);
  }
  const resolved = path.resolve(workspace, candidate);
  const rel = path.relative(workspace, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`${label} escapes the workspace root.`);
  }
  return resolved;
}

async function detectChangedFiles(workspace, pullRequest) {
  const base = pullRequest?.base?.sha;
  const head = pullRequest?.head?.sha;
  if (!base || !head) {
    return "";
  }
  try {
    const { stdout } = await execFileAsync("git", ["-C", workspace, "diff", "--name-only", `${base}...${head}`], {
      maxBuffer: 10 * 1024 * 1024
    });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(",");
  } catch (error) {
    console.log(`::warning::Failed to derive changed files from git: ${error.message}`);
    return "";
  }
}

async function runCli(workspace, args) {
  return execFileAsync("repograph", args, {
    cwd: workspace,
    maxBuffer: REPOGRAPH_CLI_MAX_BUFFER,
    timeout: REPOGRAPH_CLI_TIMEOUT_MS,
    windowsHide: true
  });
}

async function runCliJson(workspace, args, allowedExitCodes = []) {
  try {
    const { stdout } = await runCli(workspace, args);
    return parseJsonOrNull(stdout);
  } catch (error) {
    // RepoGraph commands intentionally exit non-zero when a gate
    // fails (codes 2/3/4); they still emit a complete JSON report
    // first. Recover the report from the captured stdout so the
    // comment can include the failure detail.
    const exitCode = error.code ?? error.status;
    if (typeof exitCode === "number" && allowedExitCodes.includes(exitCode)) {
      return parseJsonOrNull(error.stdout ?? "");
    }
    throw new Error(`repograph ${args.join(" ")} failed: ${error.message}`);
  }
}

function parseJsonOrNull(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // Try to recover the JSON block — `--json` output is always a
    // single JSON document, but log noise can prefix it. Use a
    // brace-balanced, string-aware scan starting from the first `{`
    // rather than `lastIndexOf("}")`, which would otherwise be
    // fooled by a stray `}` inside a violation message string.
    const startIndex = trimmed.indexOf("{");
    if (startIndex === -1) {
      return null;
    }
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    for (let index = startIndex; index < trimmed.length; index += 1) {
      const char = trimmed[index];
      if (inString) {
        if (escapeNext) {
          escapeNext = false;
        } else if (char === "\\") {
          escapeNext = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === "{") {
        depth += 1;
        continue;
      }
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(startIndex, index + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}

function writeOutputs(outputs) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }
  const lines = [];
  for (const [key, value] of Object.entries(outputs)) {
    lines.push(`${key}=${String(value).replace(/\r?\n/g, " ")}`);
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`, "utf8");
}
