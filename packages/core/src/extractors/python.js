const IMPORT_PATTERN = /^\s*import\s+(.+)$/gm;
const FROM_IMPORT_PATTERN = /^\s*from\s+([.\w]+)\s+import\s+(.+)$/gm;
const SYMBOL_PATTERNS = [
  { kind: "class", pattern: /^\s*class\s+([A-Za-z_]\w*)/gm },
  { kind: "function", pattern: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm }
];

export function extractPythonFacts(file, source) {
  const symbols = extractSymbols(source);

  return {
    ...file,
    language: "python",
    imports: extractImports(source),
    exports: extractExports(symbols),
    references: extractReferences(source, symbols),
    symbols
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
      const column = leadingWhitespace(match[0]) + 1;
      const symbolKind = kind === "function" && column > 1 ? "method" : kind;
      const key = `${symbolKind}:${name}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      symbols.push({ kind: symbolKind, name, column });
    }
  }

  return symbols;
}

function extractExports(symbols) {
  return symbols
    .filter((symbol) => (symbol.column ?? 1) === 1)
    .map((symbol) => ({ name: symbol.name }));
}

function extractReferences(source, symbols) {
  const symbolNames = new Set(symbols.map((symbol) => symbol.name));
  const references = [];
  const identifierPattern = /\b[A-Za-z_]\w*\b/g;

  for (const match of source.matchAll(identifierPattern)) {
    if (symbolNames.has(match[0])) {
      references.push({ name: match[0] });
    }
  }

  return references;
}

function leadingWhitespace(value) {
  return value.match(/^\s*/)?.[0].length ?? 0;
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
