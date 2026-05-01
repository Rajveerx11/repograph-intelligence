import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const OSV_BATCH_SIZE = 100;
const OSV_TIMEOUT_MS = 12000;
const OSV_ENDPOINT = "https://api.osv.dev/v1/querybatch";
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

const PERMISSIVE_LICENSES = new Set([
  "MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "ISC",
  "0BSD",
  "Unlicense",
  "CC0-1.0"
]);
const COPYLEFT_LICENSES = new Set([
  "GPL-2.0",
  "GPL-3.0",
  "GPL-2.0-only",
  "GPL-2.0-or-later",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "LGPL-2.1",
  "LGPL-3.0"
]);

export async function analyzeSupplyChain(repoPath, options = {}) {
  const root = path.resolve(repoPath);
  const includeOsv = options.online === true;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const manifests = await collectManifests(root);
  const dependencies = manifests.flatMap((manifest) => manifest.dependencies);

  const advisories = includeOsv
    ? await queryOsv(dependencies, fetchImpl, options.osvEndpoint ?? OSV_ENDPOINT, options.timeoutMs ?? OSV_TIMEOUT_MS)
    : [];

  const findings = buildFindings(dependencies, advisories);
  const licenseSummary = summarizeLicenses(dependencies);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    root,
    online: includeOsv,
    manifests: manifests.map((manifest) => ({
      ecosystem: manifest.ecosystem,
      path: manifest.path,
      dependencyCount: manifest.dependencies.length
    })),
    dependencyCount: dependencies.length,
    licenseSummary,
    findings,
    summary: summarize(findings, licenseSummary, includeOsv)
  };
}

async function collectManifests(root) {
  const manifests = [];
  const npmManifest = await readNpmManifest(root);
  if (npmManifest) {
    manifests.push(npmManifest);
  }
  const cargoManifest = await readCargoManifest(root);
  if (cargoManifest) {
    manifests.push(cargoManifest);
  }
  const requirementsManifest = await readRequirementsManifest(root);
  if (requirementsManifest) {
    manifests.push(requirementsManifest);
  }
  const pyprojectManifest = await readPyprojectManifest(root);
  if (pyprojectManifest) {
    manifests.push(pyprojectManifest);
  }
  return manifests;
}

async function readNpmManifest(root) {
  const manifestPath = path.join(root, "package.json");
  const raw = await safeReadJson(manifestPath);
  if (!raw) {
    return null;
  }
  const dependencies = [];
  const groups = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  for (const group of groups) {
    const entries = raw[group];
    if (!entries || typeof entries !== "object") {
      continue;
    }
    for (const [name, version] of Object.entries(entries)) {
      if (typeof name !== "string" || typeof version !== "string") {
        continue;
      }
      const license = await readNpmLicense(root, name);
      dependencies.push({
        ecosystem: "npm",
        name,
        version: stripNpmRange(version),
        rangeSpec: version,
        scope: group,
        license
      });
    }
  }
  return {
    ecosystem: "npm",
    path: path.relative(root, manifestPath) || "package.json",
    dependencies
  };
}

async function readNpmLicense(root, name) {
  const candidates = [
    path.join(root, "node_modules", name, "package.json"),
    path.join(root, "..", "node_modules", name, "package.json")
  ];
  for (const candidate of candidates) {
    const data = await safeReadJson(candidate);
    if (!data) {
      continue;
    }
    if (typeof data.license === "string") {
      return data.license;
    }
    if (data.license && typeof data.license.type === "string") {
      return data.license.type;
    }
    if (Array.isArray(data.licenses) && data.licenses[0]?.type) {
      return data.licenses[0].type;
    }
  }
  return null;
}

async function readCargoManifest(root) {
  const manifestPath = path.join(root, "Cargo.toml");
  const raw = await safeReadText(manifestPath);
  if (!raw) {
    return null;
  }
  const dependencies = parseCargoDependencies(raw);
  return {
    ecosystem: "crates.io",
    path: path.relative(root, manifestPath) || "Cargo.toml",
    dependencies
  };
}

async function readRequirementsManifest(root) {
  const manifestPath = path.join(root, "requirements.txt");
  const raw = await safeReadText(manifestPath);
  if (!raw) {
    return null;
  }
  const dependencies = parseRequirements(raw);
  return {
    ecosystem: "PyPI",
    path: path.relative(root, manifestPath) || "requirements.txt",
    dependencies
  };
}

async function readPyprojectManifest(root) {
  const manifestPath = path.join(root, "pyproject.toml");
  const raw = await safeReadText(manifestPath);
  if (!raw) {
    return null;
  }
  const dependencies = parsePyprojectDependencies(raw);
  return {
    ecosystem: "PyPI",
    path: path.relative(root, manifestPath) || "pyproject.toml",
    dependencies
  };
}

export function parseCargoDependencies(source) {
  const dependencies = [];
  const sections = source.split(/^\s*\[/m);
  for (const block of sections) {
    const headerMatch = block.match(/^([^\]]+)\]/);
    if (!headerMatch) {
      continue;
    }
    const header = headerMatch[1].trim();
    if (!isCargoDependencyHeader(header)) {
      continue;
    }
    const body = block.slice(headerMatch[0].length);
    const lines = body.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("[")) {
        continue;
      }
      const eq = trimmed.indexOf("=");
      if (eq === -1) {
        continue;
      }
      const name = trimmed.slice(0, eq).trim().replace(/^"|"$/g, "");
      const value = trimmed.slice(eq + 1).trim();
      const version = extractCargoVersion(value);
      if (!name) {
        continue;
      }
      dependencies.push({
        ecosystem: "crates.io",
        name,
        version,
        rangeSpec: value,
        scope: header,
        license: null
      });
    }
  }
  return dependencies;
}

function isCargoDependencyHeader(header) {
  return header === "dependencies"
    || header === "dev-dependencies"
    || header === "build-dependencies"
    || header.startsWith("target.")
    || header.startsWith("workspace.dependencies");
}

function extractCargoVersion(value) {
  const stripped = value.replace(/#.*$/, "").trim();
  if (stripped.startsWith("\"")) {
    const closing = stripped.indexOf("\"", 1);
    if (closing > 0) {
      return stripped.slice(1, closing);
    }
  }
  if (stripped.startsWith("{")) {
    const versionMatch = stripped.match(/version\s*=\s*"([^"]+)"/);
    return versionMatch ? versionMatch[1] : "";
  }
  return stripped;
}

export function parseRequirements(source) {
  const dependencies = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line || line.startsWith("-")) {
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_.\-]+)\s*([<>=!~]=?[^;]*)?/);
    if (!match) {
      continue;
    }
    const name = match[1];
    const range = (match[2] ?? "").trim();
    dependencies.push({
      ecosystem: "PyPI",
      name,
      version: stripPyVersion(range),
      rangeSpec: range,
      scope: "dependencies",
      license: null
    });
  }
  return dependencies;
}

export function parsePyprojectDependencies(source) {
  const dependencies = [];
  const projectMatch = source.match(/^\s*\[project\][^\[]*?dependencies\s*=\s*\[([\s\S]*?)\]/m);
  if (projectMatch) {
    for (const entry of splitTomlArrayEntries(projectMatch[1])) {
      const parsed = parseRequirements(entry);
      dependencies.push(...parsed);
    }
  }
  const poetryRegex = /^\s*\[tool\.poetry\.dependencies\]([\s\S]*?)(\n\[|$)/m;
  const poetryMatch = source.match(poetryRegex);
  if (poetryMatch) {
    for (const line of poetryMatch[1].split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const eq = trimmed.indexOf("=");
      if (eq === -1) {
        continue;
      }
      const name = trimmed.slice(0, eq).trim();
      if (name === "python") {
        continue;
      }
      const value = trimmed.slice(eq + 1).trim();
      const version = extractCargoVersion(value);
      dependencies.push({
        ecosystem: "PyPI",
        name,
        version: stripPyVersion(version),
        rangeSpec: value,
        scope: "tool.poetry.dependencies",
        license: null
      });
    }
  }
  return dependencies;
}

function splitTomlArrayEntries(body) {
  const entries = [];
  for (const part of body.split(/\r?\n/)) {
    const trimmed = part.trim().replace(/^,/, "").replace(/,$/, "").trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
      entries.push(trimmed.slice(1, -1));
    } else if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
      entries.push(trimmed.slice(1, -1));
    }
  }
  return entries;
}

function stripPyVersion(range) {
  if (!range) {
    return "";
  }
  const match = range.match(/(\d+(?:\.\d+){0,3}(?:[a-z0-9]+)?)/);
  return match ? match[1] : "";
}

function stripNpmRange(value) {
  const cleaned = value.replace(/^[\^~>=<]+\s*/, "").trim();
  const match = cleaned.match(/(\d+(?:\.\d+){0,2}(?:-[A-Za-z0-9.\-]+)?)/);
  return match ? match[1] : cleaned;
}

async function queryOsv(dependencies, fetchImpl, endpoint, timeoutMs) {
  if (typeof fetchImpl !== "function" || !dependencies.length) {
    return [];
  }
  const queries = dependencies
    .filter((dep) => dep.version)
    .map((dep) => ({
      package: { name: dep.name, ecosystem: dep.ecosystem },
      version: dep.version
    }));
  if (!queries.length) {
    return [];
  }
  const advisoriesByIndex = new Array(queries.length).fill(null).map(() => []);
  for (let offset = 0; offset < queries.length; offset += OSV_BATCH_SIZE) {
    const slice = queries.slice(offset, offset + OSV_BATCH_SIZE);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queries: slice }),
        signal: controller.signal
      });
      if (!response.ok) {
        continue;
      }
      const json = await response.json();
      const results = Array.isArray(json?.results) ? json.results : [];
      for (let index = 0; index < results.length; index += 1) {
        const vulnerabilities = Array.isArray(results[index]?.vulns) ? results[index].vulns : [];
        for (const advisory of vulnerabilities) {
          advisoriesByIndex[offset + index].push({
            id: advisory.id,
            summary: advisory.summary ?? null,
            severity: extractSeverity(advisory),
            references: Array.isArray(advisory.references)
              ? advisory.references.map((reference) => reference.url).filter(Boolean).slice(0, 3)
              : []
          });
        }
      }
    } catch {
      // Network failure → skip batch.
    } finally {
      clearTimeout(timeout);
    }
  }
  const merged = [];
  for (let index = 0; index < queries.length; index += 1) {
    if (advisoriesByIndex[index].length) {
      merged.push({
        dependency: dependencies[index],
        advisories: advisoriesByIndex[index]
      });
    }
  }
  return merged;
}

function extractSeverity(advisory) {
  if (Array.isArray(advisory.severity) && advisory.severity[0]?.score) {
    return advisory.severity[0].score;
  }
  if (Array.isArray(advisory.affected)) {
    for (const affected of advisory.affected) {
      const ecosystemSeverity = affected?.database_specific?.severity;
      if (typeof ecosystemSeverity === "string") {
        return ecosystemSeverity;
      }
    }
  }
  return "UNKNOWN";
}

function buildFindings(dependencies, advisoriesByDependency) {
  const findings = [];
  const advisoriesIndex = new Map();
  for (const entry of advisoriesByDependency) {
    advisoriesIndex.set(`${entry.dependency.ecosystem}:${entry.dependency.name}@${entry.dependency.version}`, entry.advisories);
  }
  for (const dependency of dependencies) {
    const key = `${dependency.ecosystem}:${dependency.name}@${dependency.version}`;
    const advisories = advisoriesIndex.get(key) ?? [];
    if (advisories.length) {
      findings.push({
        type: "vulnerable_dependency",
        severity: maxSeverity(advisories),
        ecosystem: dependency.ecosystem,
        name: dependency.name,
        version: dependency.version,
        scope: dependency.scope,
        advisories
      });
    }
    const licenseRisk = classifyLicense(dependency.license);
    if (licenseRisk) {
      findings.push({
        type: "license_risk",
        severity: licenseRisk.severity,
        ecosystem: dependency.ecosystem,
        name: dependency.name,
        version: dependency.version,
        scope: dependency.scope,
        license: dependency.license,
        message: licenseRisk.message
      });
    }
    if (!dependency.version) {
      findings.push({
        type: "unpinned_dependency",
        severity: "low",
        ecosystem: dependency.ecosystem,
        name: dependency.name,
        scope: dependency.scope,
        message: "Dependency has no resolved version - audit drift cannot be verified."
      });
    }
  }
  findings.sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || left.name.localeCompare(right.name));
  return findings;
}

function classifyLicense(license) {
  if (!license) {
    return null;
  }
  const normalized = license.trim();
  if (PERMISSIVE_LICENSES.has(normalized)) {
    return null;
  }
  if (COPYLEFT_LICENSES.has(normalized)) {
    return {
      severity: "medium",
      message: `Copyleft license '${normalized}' may impose distribution requirements.`
    };
  }
  if (/UNLICENSED|proprietary/i.test(normalized)) {
    return {
      severity: "high",
      message: `License '${normalized}' is proprietary or unlicensed.`
    };
  }
  return {
    severity: "low",
    message: `License '${normalized}' is uncommon - review terms.`
  };
}

function summarizeLicenses(dependencies) {
  const counts = new Map();
  for (const dependency of dependencies) {
    const key = dependency.license ?? "UNKNOWN";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([license, count]) => ({ license, count }))
    .sort((left, right) => right.count - left.count || left.license.localeCompare(right.license));
}

function summarize(findings, licenseSummary, online) {
  const high = findings.filter((finding) => finding.severity === "high" || finding.severity === "HIGH" || finding.severity === "CRITICAL").length;
  const medium = findings.filter((finding) => finding.severity === "medium" || finding.severity === "MEDIUM").length;
  const low = findings.filter((finding) => finding.severity === "low" || finding.severity === "LOW").length;
  const advisoryCount = findings.filter((finding) => finding.type === "vulnerable_dependency").length;
  const licenseLine = licenseSummary.length
    ? `Top licenses: ${licenseSummary.slice(0, 3).map((entry) => `${entry.license} (${entry.count})`).join(", ")}.`
    : "No license metadata detected.";
  const onlineLine = online
    ? `${advisoryCount} dependency advisory match(es) from OSV.`
    : "Run with online mode for OSV advisory checks.";
  return `Supply chain: ${high} high, ${medium} medium, ${low} low risk(s). ${onlineLine} ${licenseLine}`;
}

function severityRank(severity) {
  if (!severity) {
    return 0;
  }
  const upper = String(severity).toUpperCase();
  if (upper.includes("CRITICAL")) return 4;
  if (upper.includes("HIGH")) return 3;
  if (upper.includes("MEDIUM") || upper.includes("MODERATE")) return 2;
  if (upper.includes("LOW")) return 1;
  return 0;
}

function maxSeverity(advisories) {
  let best = "low";
  let bestRank = 0;
  for (const advisory of advisories) {
    const rank = severityRank(advisory.severity);
    if (rank > bestRank) {
      bestRank = rank;
      best = advisory.severity;
    }
  }
  return best;
}

async function safeReadJson(filePath) {
  const raw = await safeReadText(filePath);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function safeReadText(filePath) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size > MAX_MANIFEST_BYTES) {
      return null;
    }
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}
