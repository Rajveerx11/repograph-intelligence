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
  { kind: "function", pattern: /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g }
];

export function extractJavaScriptFacts(file, source) {
  return {
    ...file,
    language: "javascript",
    imports: extractImports(source),
    symbols: extractSymbols(source)
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
        isRelative: specifier.startsWith(".")
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

