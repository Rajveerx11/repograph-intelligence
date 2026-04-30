const IMPORT_PATTERNS = [
  /\bimport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
  /\bexport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
];

const SYMBOL_PATTERNS = [
  { kind: "class", pattern: /\b(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/g },
  { kind: "interface", pattern: /\bexport\s+interface\s+([A-Za-z_$][\w$]*)/g },
  { kind: "function", pattern: /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g },
  { kind: "function", pattern: /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g },
  { kind: "function", pattern: /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g },
  { kind: "method", pattern: /^[ \t]+(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm }
];

const EXPORT_PATTERNS = [
  /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s*\{([^}]+)\}/g
];

export function extractJavaScriptFacts(file, source) {
  const symbols = extractSymbols(source);

  return {
    ...file,
    language: "javascript",
    imports: extractImports(source),
    exports: extractExports(source),
    references: extractReferences(source, symbols),
    symbols
  };
}

function extractImports(source) {
  const imports = [];
  const seen = new Set();

  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (!specifier || seen.has(specifier)) {
        continue;
      }
      seen.add(specifier);
      imports.push({
        kind: "import",
        specifier,
        isRelative: specifier.startsWith("."),
        importedNames: extractImportedNames(match[0])
      });
    }
  }

  return imports;
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

function extractExports(source) {
  const exports = [];
  const seen = new Set();

  for (const pattern of EXPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      for (const name of splitNames(match[1])) {
        if (seen.has(name)) {
          continue;
        }
        seen.add(name);
        exports.push({ name });
      }
    }
  }

  return exports;
}

function extractReferences(source, symbols) {
  const symbolNames = new Set(symbols.map((symbol) => symbol.name));
  const references = [];
  const identifierPattern = /\b[A-Za-z_$][\w$]*\b/g;

  for (const match of source.matchAll(identifierPattern)) {
    if (symbolNames.has(match[0])) {
      references.push({ name: match[0] });
    }
  }

  return references;
}

function extractImportedNames(importStatement) {
  const namedImport = importStatement.match(/\{([^}]+)\}/);
  if (namedImport) {
    return splitNames(namedImport[1]);
  }

  const defaultImport = importStatement.match(/\bimport\s+([A-Za-z_$][\w$]*)\s+from\b/);
  if (defaultImport) {
    return [defaultImport[1]];
  }

  return [];
}

function splitNames(value) {
  return value
    .split(",")
    .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
    .filter(Boolean);
}
