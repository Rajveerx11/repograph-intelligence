const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "if",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "return",
  "that",
  "the",
  "this",
  "to",
  "with"
]);

export function createSemanticText(fileFacts, source) {
  const comments = extractComments(source, fileFacts.language);
  const importText = fileFacts.imports
    .map((item) => [item.specifier, ...(item.importedNames ?? [])].join(" "))
    .join(" ");
  const symbolText = fileFacts.symbols
    .map((symbol) => `${symbol.kind} ${symbol.name}`)
    .join(" ");
  const pathText = fileFacts.relativePath.replace(/[\\/._-]/g, " ");
  const identifierText = extractIdentifiers(source).slice(0, 200).join(" ");

  return [pathText, symbolText, importText, comments, identifierText].filter(Boolean).join("\n");
}

export function buildSemanticIndex(graph) {
  const documents = graph.nodes
    .filter((node) => node.type === "file")
    .map((node) => {
      const tokens = tokenize([
        node.path,
        node.language,
        node.semanticText ?? "",
        node.label
      ].join(" "));

      return {
        id: node.id,
        path: node.path,
        language: node.language,
        tokens,
        termFrequency: termFrequency(tokens)
      };
    });

  const documentFrequency = new Map();
  for (const document of documents) {
    for (const token of new Set(document.tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const idf = new Map();
  for (const [term, count] of documentFrequency) {
    idf.set(term, Math.log((1 + documents.length) / (1 + count)) + 1);
  }

  return {
    version: 1,
    documents,
    idf
  };
}

export function semanticSearch(graph, query, options = {}) {
  const limit = options.limit ?? 10;
  const index = options.index ?? buildSemanticIndex(graph);
  const queryTokens = tokenize(query);
  const queryVector = vectorize(termFrequency(queryTokens), index.idf);

  return index.documents
    .map((document) => {
      const documentVector = vectorize(document.termFrequency, index.idf);
      const score = cosineSimilarity(queryVector, documentVector);
      return {
        path: document.path,
        language: document.language,
        score: Number(score.toFixed(4)),
        matchedTerms: topMatchedTerms(queryTokens, document.tokens)
      };
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, limit);
}

export function tokenize(text) {
  return splitCamelCase(text)
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function extractComments(source, language) {
  if (language === "python") {
    return [
      ...source.matchAll(/^\s*#\s?(.*)$/gm),
      ...source.matchAll(/"""([\s\S]*?)"""/g),
      ...source.matchAll(/'''([\s\S]*?)'''/g)
    ]
      .map((match) => match[1])
      .join("\n");
  }

  return [
    ...source.matchAll(/\/\/\s?(.*)$/gm),
    ...source.matchAll(/\/\*([\s\S]*?)\*\//g)
  ]
    .map((match) => match[1])
    .join("\n");
}

function extractIdentifiers(source) {
  const identifiers = source.match(/[A-Za-z_$][\w$]*/g) ?? [];
  const seen = new Set();
  return identifiers.filter((identifier) => {
    const normalized = identifier.toLowerCase();
    if (STOP_WORDS.has(normalized) || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function splitCamelCase(text) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

function termFrequency(tokens) {
  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function vectorize(termFrequencyMap, idf) {
  const vector = new Map();
  for (const [term, count] of termFrequencyMap) {
    vector.set(term, count * (idf.get(term) ?? 1));
  }
  return vector;
}

function cosineSimilarity(left, right) {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (const value of left.values()) {
    leftMagnitude += value * value;
  }
  for (const value of right.values()) {
    rightMagnitude += value * value;
  }
  for (const [term, value] of left) {
    dot += value * (right.get(term) ?? 0);
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function topMatchedTerms(queryTokens, documentTokens) {
  const documentSet = new Set(documentTokens);
  return Array.from(new Set(queryTokens.filter((token) => documentSet.has(token)))).slice(0, 5);
}

