import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_POLICY_BYTES = 1 * 1024 * 1024;
const SUPPORTED_RULE_TYPES = new Set([
  "forbid-import",
  "forbid-dependency",
  "no-cycles",
  "max-imports",
  "max-lines",
  "require-import",
  "max-fan-in",
  "layered",
  "naming-convention"
]);
const MAX_NAMING_PATTERN_LENGTH = 512;
const SEVERITY_RANK = { info: 1, warning: 2, error: 3 };

/**
 * Load a policy file from disk. Currently only JSON is supported to keep
 * the runtime dependency surface at zero; YAML support can be added later
 * behind a dynamic import.
 *
 * @param {string} policyPath
 * @param {object} [options]
 * @param {number} [options.maxBytes]
 */
export async function loadPolicy(policyPath, options = {}) {
  const absolutePath = path.resolve(policyPath);
  const maxBytes = boundedInt(options.maxBytes, DEFAULT_MAX_POLICY_BYTES, 1, 50 * 1024 * 1024);
  const info = await stat(absolutePath);
  if (!info.isFile()) {
    throw new Error("Policy path must be a file.");
  }
  if (info.size > maxBytes) {
    throw new Error(`Policy file exceeds maximum size of ${maxBytes} bytes.`);
  }
  if (!absolutePath.endsWith(".json")) {
    throw new Error("Policy files must use a .json extension (YAML support is planned).");
  }
  const source = await readFile(absolutePath, "utf8");
  let policy;
  try {
    policy = JSON.parse(source);
  } catch (error) {
    throw new Error(`Policy file is not valid JSON: ${error.message}`);
  }
  return validatePolicy(policy);
}

/**
 * Validate the shape of a parsed policy object. Throws on malformed
 * rules so the engine never sees ambiguous input.
 *
 * @param {unknown} policy
 * @returns {{ version: number, rules: Array<object> }}
 */
export function validatePolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("Policy must be an object.");
  }
  const version = policy.version === undefined ? 1 : policy.version;
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("Policy version must be a positive integer.");
  }
  if (!Array.isArray(policy.rules)) {
    throw new Error("Policy must have a 'rules' array.");
  }

  const seenIds = new Set();
  const rules = policy.rules.map((rule, index) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      throw new Error(`Rule at index ${index} must be an object.`);
    }
    if (typeof rule.id !== "string" || !rule.id.trim()) {
      throw new Error(`Rule at index ${index} requires a non-empty 'id'.`);
    }
    if (seenIds.has(rule.id)) {
      throw new Error(`Duplicate rule id: ${rule.id}`);
    }
    seenIds.add(rule.id);
    if (!SUPPORTED_RULE_TYPES.has(rule.type)) {
      throw new Error(`Rule '${rule.id}' has unsupported type '${rule.type}'. Supported: ${[...SUPPORTED_RULE_TYPES].join(", ")}.`);
    }
    const severity = rule.severity ?? "error";
    if (!SEVERITY_RANK[severity]) {
      throw new Error(`Rule '${rule.id}' has invalid severity '${severity}'. Use info, warning, or error.`);
    }

    validateRuleFields(rule);

    return { ...rule, severity };
  });

  return { version, rules };
}

function validateRuleFields(rule) {
  switch (rule.type) {
    case "forbid-import":
      requireString(rule, "from");
      requireString(rule, "to");
      break;
    case "forbid-dependency":
      requireString(rule, "from");
      requireString(rule, "to");
      break;
    case "no-cycles":
      if (rule.scope !== undefined) {
        requireString(rule, "scope");
      }
      break;
    case "max-imports":
      requireString(rule, "target");
      requirePositiveInt(rule, "limit");
      break;
    case "max-lines":
      requireString(rule, "target");
      requirePositiveInt(rule, "limit");
      break;
    case "require-import":
      requireString(rule, "from");
      requireString(rule, "to");
      break;
    case "max-fan-in":
      requireString(rule, "target");
      requirePositiveInt(rule, "limit");
      break;
    case "layered":
      validateLayeredRule(rule);
      break;
    case "naming-convention":
      requireString(rule, "target");
      requireString(rule, "pattern");
      if (rule.pattern.length > MAX_NAMING_PATTERN_LENGTH) {
        throw new Error(`Rule '${rule.id}' pattern exceeds ${MAX_NAMING_PATTERN_LENGTH} characters.`);
      }
      try {
        new RegExp(rule.pattern);
      } catch (error) {
        throw new Error(`Rule '${rule.id}' pattern is not a valid regular expression: ${error.message}`);
      }
      if (rule.appliesTo !== undefined && !["basename", "path"].includes(rule.appliesTo)) {
        throw new Error(`Rule '${rule.id}' appliesTo must be 'basename' or 'path'.`);
      }
      break;
    default:
      break;
  }
}

function validateLayeredRule(rule) {
  if (!Array.isArray(rule.layers) || rule.layers.length < 2) {
    throw new Error(`Rule '${rule.id}' requires a 'layers' array with at least two entries.`);
  }
  const seenNames = new Set();
  for (const [index, layer] of rule.layers.entries()) {
    if (!layer || typeof layer !== "object" || Array.isArray(layer)) {
      throw new Error(`Rule '${rule.id}' layer at index ${index} must be an object.`);
    }
    if (typeof layer.name !== "string" || !layer.name.trim()) {
      throw new Error(`Rule '${rule.id}' layer at index ${index} requires a non-empty 'name'.`);
    }
    if (seenNames.has(layer.name)) {
      throw new Error(`Rule '${rule.id}' has duplicate layer name '${layer.name}'.`);
    }
    seenNames.add(layer.name);
    if (typeof layer.glob !== "string" || !layer.glob.trim()) {
      throw new Error(`Rule '${rule.id}' layer '${layer.name}' requires a 'glob' string.`);
    }
  }
}

function requireString(rule, field) {
  if (typeof rule[field] !== "string" || !rule[field].trim()) {
    throw new Error(`Rule '${rule.id}' requires string field '${field}'.`);
  }
}

function requirePositiveInt(rule, field) {
  if (!Number.isInteger(rule[field]) || rule[field] < 1) {
    throw new Error(`Rule '${rule.id}' requires positive integer field '${field}'.`);
  }
}

/**
 * Evaluate a policy against a graph. Returns a structured report with
 * per-rule violations and an aggregate verdict.
 *
 * @param {object} graph
 * @param {object} policy - Already validated via `validatePolicy`.
 * @param {object} [options]
 * @param {"info"|"warning"|"error"} [options.failOn="error"]
 */
export function evaluatePolicy(graph, policy, options = {}) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error("evaluatePolicy requires a graph with nodes and edges arrays.");
  }
  const failOn = options.failOn && SEVERITY_RANK[options.failOn] ? options.failOn : "error";
  const failThreshold = SEVERITY_RANK[failOn];

  const fileNodes = graph.nodes.filter((node) => node.type === "file");
  const fileById = new Map(fileNodes.map((node) => [node.id, node]));
  const packageById = new Map(
    graph.nodes.filter((node) => node.type === "package").map((node) => [node.id, node])
  );

  const violations = [];
  for (const rule of policy.rules) {
    const ruleViolations = evaluateRule(rule, graph, { fileNodes, fileById, packageById });
    for (const violation of ruleViolations) {
      violations.push({
        ruleId: rule.id,
        ruleType: rule.type,
        severity: rule.severity,
        ...violation
      });
    }
  }

  const counts = { info: 0, warning: 0, error: 0 };
  for (const violation of violations) {
    counts[violation.severity] = (counts[violation.severity] ?? 0) + 1;
  }
  const passed = !violations.some((violation) => SEVERITY_RANK[violation.severity] >= failThreshold);

  return {
    generatedAt: new Date().toISOString(),
    rulesEvaluated: policy.rules.length,
    failOn,
    passed,
    counts,
    violations
  };
}

function evaluateRule(rule, graph, indexes) {
  switch (rule.type) {
    case "forbid-import":
      return evaluateForbidImport(rule, graph, indexes);
    case "forbid-dependency":
      return evaluateForbidDependency(rule, graph, indexes);
    case "no-cycles":
      return evaluateNoCycles(rule, graph, indexes);
    case "max-imports":
      return evaluateMaxImports(rule, indexes);
    case "max-lines":
      return evaluateMaxLines(rule, indexes);
    case "require-import":
      return evaluateRequireImport(rule, graph, indexes);
    case "max-fan-in":
      return evaluateMaxFanIn(rule, graph, indexes);
    case "layered":
      return evaluateLayered(rule, graph, indexes);
    case "naming-convention":
      return evaluateNamingConvention(rule, indexes);
    default:
      return [];
  }
}

function evaluateForbidImport(rule, graph, { fileById }) {
  const fromMatch = compileGlob(rule.from);
  const toMatch = compileGlob(rule.to);
  const violations = [];
  for (const edge of graph.edges) {
    if (edge.type !== "imports") {
      continue;
    }
    const fromNode = fileById.get(edge.from);
    const toNode = fileById.get(edge.to);
    if (!fromNode || !toNode) {
      continue;
    }
    if (fromMatch(fromNode.path) && toMatch(toNode.path)) {
      violations.push({
        message: `${fromNode.path} imports ${toNode.path} but rule forbids it.`,
        from: fromNode.path,
        to: toNode.path
      });
    }
  }
  return violations;
}

function evaluateForbidDependency(rule, graph, { fileById, packageById }) {
  const fromMatch = compileGlob(rule.from);
  const toMatch = compileGlob(rule.to);
  const violations = [];
  for (const edge of graph.edges) {
    if (edge.type !== "dependency") {
      continue;
    }
    const fromNode = fileById.get(edge.from);
    const pkgNode = packageById.get(edge.to);
    if (!fromNode || !pkgNode) {
      continue;
    }
    if (fromMatch(fromNode.path) && toMatch(pkgNode.label ?? "")) {
      violations.push({
        message: `${fromNode.path} depends on ${pkgNode.label} but rule forbids it.`,
        from: fromNode.path,
        to: pkgNode.label
      });
    }
  }
  return violations;
}

function evaluateNoCycles(rule, graph, { fileNodes, fileById }) {
  const scopeMatch = rule.scope ? compileGlob(rule.scope) : () => true;
  const scopedNodes = fileNodes.filter((node) => scopeMatch(node.path));
  const scopedIds = new Set(scopedNodes.map((node) => node.id));
  const adjacency = new Map(scopedNodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    if (edge.type !== "imports") {
      continue;
    }
    if (scopedIds.has(edge.from) && scopedIds.has(edge.to)) {
      adjacency.get(edge.from).push(edge.to);
    }
  }

  const state = new Map();
  const stack = [];
  const seenCycles = new Set();
  const cycles = [];

  function visit(nodeId) {
    state.set(nodeId, "visiting");
    stack.push(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) {
      if (!state.has(next)) {
        visit(next);
        continue;
      }
      if (state.get(next) === "visiting") {
        const start = stack.indexOf(next);
        const cyclePaths = stack.slice(start).concat(next).map((id) => fileById.get(id).path);
        const key = canonicalCycleKey(cyclePaths);
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          cycles.push(cyclePaths);
        }
      }
    }
    stack.pop();
    state.set(nodeId, "visited");
  }

  for (const node of scopedNodes) {
    if (!state.has(node.id)) {
      visit(node.id);
    }
  }

  return cycles.map((cyclePaths) => ({
    message: `Cycle detected${rule.scope ? ` within '${rule.scope}'` : ""}: ${cyclePaths.join(" -> ")}`,
    cycle: cyclePaths
  }));
}

function evaluateMaxImports(rule, { fileNodes }) {
  const match = compileGlob(rule.target);
  const violations = [];
  for (const node of fileNodes) {
    if (!match(node.path)) {
      continue;
    }
    const count = node.importCount ?? 0;
    if (count > rule.limit) {
      violations.push({
        message: `${node.path} has ${count} imports, exceeds limit ${rule.limit}.`,
        target: node.path,
        actual: count,
        limit: rule.limit
      });
    }
  }
  return violations;
}

function evaluateMaxLines(rule, { fileNodes }) {
  const match = compileGlob(rule.target);
  const violations = [];
  for (const node of fileNodes) {
    if (!match(node.path)) {
      continue;
    }
    const lines = node.lineCount ?? 0;
    if (lines > rule.limit) {
      violations.push({
        message: `${node.path} has ${lines} lines, exceeds limit ${rule.limit}.`,
        target: node.path,
        actual: lines,
        limit: rule.limit
      });
    }
  }
  return violations;
}

/**
 * Compile a tiny glob into a predicate. Supports `**` (zero or more
 * path segments), `*` (a single segment fragment), and `?` (one
 * non-slash character). All other characters match literally.
 */
export function compileGlob(pattern) {
  if (typeof pattern !== "string") {
    throw new Error("Glob pattern must be a string.");
  }
  if (pattern === "" || pattern === "**") {
    return () => true;
  }
  const normalized = pattern.replace(/\\/g, "/");
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === "*") {
      if (normalized[index + 1] === "*") {
        source += ".*";
        index += 1;
        if (normalized[index + 1] === "/") {
          index += 1;
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    if (/[.+^${}()|[\]\\]/.test(char)) {
      source += `\\${char}`;
      continue;
    }
    source += char;
  }
  source += "$";
  const regex = new RegExp(source);
  return (value) => regex.test(String(value ?? "").replace(/\\/g, "/"));
}

function canonicalCycleKey(paths) {
  let smallest = paths[0];
  let smallestIndex = 0;
  for (let index = 1; index < paths.length - 1; index += 1) {
    if (paths[index] < smallest) {
      smallest = paths[index];
      smallestIndex = index;
    }
  }
  const rotated = paths.slice(smallestIndex, -1).concat(paths.slice(0, smallestIndex));
  return rotated.join("|");
}

function evaluateRequireImport(rule, graph, { fileNodes, fileById }) {
  const fromMatch = compileGlob(rule.from);
  const toMatch = compileGlob(rule.to);
  const requiredFiles = fileNodes.filter((node) => fromMatch(node.path ?? ""));
  if (!requiredFiles.length) {
    return [];
  }
  const importsByFrom = new Map();
  for (const edge of graph.edges) {
    if (edge.type !== "imports") {
      continue;
    }
    if (!importsByFrom.has(edge.from)) {
      importsByFrom.set(edge.from, []);
    }
    importsByFrom.get(edge.from).push(edge.to);
  }
  const violations = [];
  for (const file of requiredFiles) {
    const importedIds = importsByFrom.get(file.id) ?? [];
    const hasMatch = importedIds.some((targetId) => {
      const targetNode = fileById.get(targetId);
      return targetNode && toMatch(targetNode.path ?? "");
    });
    if (!hasMatch) {
      violations.push({
        message: `${file.path} matches '${rule.from}' but does not import any file matching '${rule.to}'.`,
        target: file.path,
        expected: rule.to
      });
    }
  }
  return violations;
}

function evaluateMaxFanIn(rule, graph, { fileNodes, fileById }) {
  const match = compileGlob(rule.target);
  const fanIn = new Map();
  for (const edge of graph.edges) {
    if (edge.type !== "imports") {
      continue;
    }
    if (!fileById.has(edge.to)) {
      continue;
    }
    fanIn.set(edge.to, (fanIn.get(edge.to) ?? 0) + 1);
  }
  const violations = [];
  for (const node of fileNodes) {
    if (!match(node.path ?? "")) {
      continue;
    }
    const count = fanIn.get(node.id) ?? 0;
    if (count > rule.limit) {
      violations.push({
        message: `${node.path} has fan-in ${count}, exceeds limit ${rule.limit}.`,
        target: node.path,
        actual: count,
        limit: rule.limit
      });
    }
  }
  return violations;
}

function evaluateLayered(rule, graph, { fileNodes, fileById }) {
  const layerMatchers = rule.layers.map((layer) => ({
    name: layer.name,
    match: compileGlob(layer.glob)
  }));
  const layerOf = new Map();
  for (const node of fileNodes) {
    const filePath = node.path ?? "";
    for (let layerIndex = 0; layerIndex < layerMatchers.length; layerIndex += 1) {
      if (layerMatchers[layerIndex].match(filePath)) {
        layerOf.set(node.id, layerIndex);
        break;
      }
    }
  }
  const violations = [];
  const seen = new Set();
  for (const edge of graph.edges) {
    if (edge.type !== "imports") {
      continue;
    }
    const fromLayer = layerOf.get(edge.from);
    const toLayer = layerOf.get(edge.to);
    if (fromLayer === undefined || toLayer === undefined) {
      continue;
    }
    // Imports must flow from lower-indexed layers (more abstract / higher
    // in the stack) toward higher-indexed layers (more concrete). An edge
    // whose target sits in a strictly lower-indexed layer is a violation:
    // it imports "upward" against the declared layering.
    if (toLayer < fromLayer) {
      const key = `${edge.from}->${edge.to}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const fromNode = fileById.get(edge.from);
      const toNode = fileById.get(edge.to);
      violations.push({
        message: `${fromNode?.path ?? edge.from} (${layerMatchers[fromLayer].name}) imports ${toNode?.path ?? edge.to} (${layerMatchers[toLayer].name}), violating declared layer order.`,
        from: fromNode?.path ?? edge.from,
        to: toNode?.path ?? edge.to,
        fromLayer: layerMatchers[fromLayer].name,
        toLayer: layerMatchers[toLayer].name
      });
    }
  }
  return violations;
}

function evaluateNamingConvention(rule, { fileNodes }) {
  const targetMatch = compileGlob(rule.target);
  const regex = new RegExp(rule.pattern);
  const appliesTo = rule.appliesTo ?? "basename";
  const violations = [];
  for (const node of fileNodes) {
    if (!node.path || !targetMatch(node.path)) {
      continue;
    }
    const candidate = appliesTo === "path"
      ? node.path.replace(/\\/g, "/")
      : path.posix.basename(node.path.replace(/\\/g, "/"));
    if (!regex.test(candidate)) {
      violations.push({
        message: `${node.path} does not match naming pattern '${rule.pattern}' (${appliesTo}).`,
        target: node.path,
        expected: rule.pattern,
        appliesTo
      });
    }
  }
  return violations;
}

function boundedInt(value, fallback, min, max) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}
