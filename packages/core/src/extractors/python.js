const IMPORT_PATTERN = /^\s*import\s+(.+)$/gm;
const FROM_IMPORT_PATTERN = /^\s*from\s+([.\w]+)\s+import\s+(.+)$/gm;
const SYMBOL_PATTERNS = [
  { kind: "class", pattern: /^\s*class\s+([A-Za-z_]\w*)/gm },
  { kind: "function", pattern: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm }
];

export function extractPythonFacts(file, source) {
  return {
    ...file,
    language: "python",
    imports: extractImports(source),
    symbols: extractSymbols(source)
  };
}

function extractImports(source) {
  const imports = [];

  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const modules = match[1]
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/)[0])
      .filter(Boolean);

    for (const moduleName of modules) {
      imports.push({
        kind: "import",
        specifier: moduleName,
        isRelative: moduleName.startsWith(".")
      });
    }
  }

  for (const match of source.matchAll(FROM_IMPORT_PATTERN)) {
    const moduleName = match[1];
    const importedNames = match[2]
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/)[0])
      .filter(Boolean);

    imports.push({
      kind: "from-import",
      specifier: moduleName,
      importedNames,
      isRelative: moduleName.startsWith(".")
    });
  }

  return dedupeImports(imports);
}

function extractSymbols(source) {
  const symbols = [];
  const seen = new Set();

  for (const { kind, pattern } of SYMBOL_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      const key = `${kind}:${name}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      symbols.push({ kind, name });
    }
  }

  return symbols;
}

function dedupeImports(imports) {
  const seen = new Set();
  return imports.filter((item) => {
    const key = `${item.kind}:${item.specifier}:${(item.importedNames ?? []).join(",")}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

