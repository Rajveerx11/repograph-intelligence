import path from "node:path";
import { toGraphPath } from "./scanner.js";

const JAVASCRIPT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const PYTHON_EXTENSIONS = [".py"];

export function buildGraph({ root, files }) {
  const graph = {
    version: 1,
    generatedAt: new Date().toISOString(),
    root,
    nodes: [],
    edges: []
  };

  const fileByPath = new Map(files.map((file) => [file.relativePath, file]));

  for (const file of files) {
    graph.nodes.push({
      id: fileNodeId(file.relativePath),
      type: "file",
      label: path.basename(file.relativePath),
      path: file.relativePath,
      language: file.language,
      lineCount: file.lineCount,
      semanticText: file.semanticText,
      symbolCount: file.symbols.length,
      importCount: file.imports.length,
      exportCount: file.exports?.length ?? 0,
      referenceCount: file.references?.length ?? 0
    });

    for (const symbol of file.symbols) {
      const symbolId = symbolNodeId(file.relativePath, symbol.name);
      graph.nodes.push({
        id: symbolId,
        type: symbol.kind,
        label: symbol.name,
        path: file.relativePath,
        language: file.language
      });
      graph.edges.push({
        id: edgeId("contains", fileNodeId(file.relativePath), symbolId),
        type: "contains",
        from: fileNodeId(file.relativePath),
        to: symbolId
      });
    }
  }

  const existingNodeIds = new Set(graph.nodes.map((node) => node.id));

  for (const file of files) {
    for (const importFact of file.imports) {
      const resolvedPath = resolveImport(file, importFact.specifier, fileByPath);
      const from = fileNodeId(file.relativePath);

      if (resolvedPath) {
        graph.edges.push({
          id: edgeId("imports", from, fileNodeId(resolvedPath), importFact.specifier),
          type: "imports",
          from,
          to: fileNodeId(resolvedPath),
          specifier: importFact.specifier,
          scope: "internal"
        });
        continue;
      }

      const packageName = packageNameFromSpecifier(importFact.specifier);
      const packageId = packageNodeId(packageName);
      if (!graph.nodes.some((node) => node.id === packageId)) {
        graph.nodes.push({
          id: packageId,
          type: "package",
          label: packageName
        });
      }

      graph.edges.push({
        id: edgeId("dependency", from, packageId, importFact.specifier),
        type: "dependency",
        from,
        to: packageId,
        specifier: importFact.specifier,
        scope: "external"
      });
    }

    for (const exportFact of file.exports ?? []) {
      const from = fileNodeId(file.relativePath);
      const to = symbolNodeId(file.relativePath, exportFact.name);

      if (!existingNodeIds.has(to)) {
        continue;
      }

      graph.edges.push({
        id: edgeId("exports", from, to, exportFact.name),
        type: "exports",
        from,
        to,
        exportedName: exportFact.name
      });
    }
  }

  graph.nodes.sort((left, right) => left.id.localeCompare(right.id));
  graph.edges.sort((left, right) => left.id.localeCompare(right.id));
  return graph;
}

function resolveImport(sourceFile, specifier, fileByPath) {
  if (sourceFile.language === "javascript") {
    return resolveJavaScriptImport(sourceFile, specifier, fileByPath);
  }

  if (sourceFile.language === "python") {
    return resolvePythonImport(sourceFile, specifier, fileByPath);
  }

  return null;
}

function resolveJavaScriptImport(sourceFile, specifier, fileByPath) {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const baseDirectory = path.posix.dirname(sourceFile.relativePath);
  const candidate = toGraphPath(path.posix.normalize(path.posix.join(baseDirectory, specifier)));
  return firstExisting(fileByPath, [
    candidate,
    ...JAVASCRIPT_EXTENSIONS.map((extension) => `${candidate}${extension}`),
    ...JAVASCRIPT_EXTENSIONS.map((extension) => `${candidate}/index${extension}`)
  ]);
}

function resolvePythonImport(sourceFile, specifier, fileByPath) {
  const baseDirectory = path.posix.dirname(sourceFile.relativePath);

  if (specifier.startsWith(".")) {
    const dotCount = specifier.match(/^\.+/)?.[0].length ?? 0;
    const modulePath = specifier.slice(dotCount).replaceAll(".", "/");
    let directory = baseDirectory;
    for (let index = 1; index < dotCount; index += 1) {
      directory = path.posix.dirname(directory);
    }

    const candidate = toGraphPath(path.posix.normalize(path.posix.join(directory, modulePath)));
    return firstExisting(fileByPath, pythonCandidates(candidate));
  }

  const absoluteCandidate = specifier.replaceAll(".", "/");
  const relativeCandidate = toGraphPath(path.posix.join(baseDirectory, absoluteCandidate));

  return firstExisting(fileByPath, [
    ...pythonCandidates(relativeCandidate),
    ...pythonCandidates(absoluteCandidate)
  ]);
}

function pythonCandidates(candidate) {
  return [
    candidate,
    ...PYTHON_EXTENSIONS.map((extension) => `${candidate}${extension}`),
    ...PYTHON_EXTENSIONS.map((extension) => `${candidate}/__init__${extension}`)
  ];
}

function firstExisting(fileByPath, candidates) {
  return candidates.find((candidate) => fileByPath.has(candidate)) ?? null;
}

function packageNameFromSpecifier(specifier) {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}

function fileNodeId(relativePath) {
  return `file:${relativePath}`;
}

function symbolNodeId(relativePath, symbolName) {
  return `symbol:${relativePath}:${symbolName}`;
}

function packageNodeId(packageName) {
  return `package:${packageName}`;
}

function edgeId(type, from, to, extra = "") {
  return `${type}:${from}->${to}:${extra}`;
}
