const KEYWORDS_BEFORE_REGEX = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "do",
  "else",
  "case",
  "throw",
  "new",
  "delete",
  "void",
  "yield",
  "await",
  "if",
  "while",
  "for",
  "switch"
]);

export function maskJavaScriptSource(source) {
  const length = source.length;
  const output = new Array(length);
  let index = 0;
  let lastSignificantToken = "";

  function mask(start, end) {
    for (let position = start; position < end; position += 1) {
      const character = source[position];
      output[position] = character === "\n" || character === "\r" ? character : " ";
    }
  }

  function copy(start, end) {
    for (let position = start; position < end; position += 1) {
      output[position] = source[position];
    }
  }

  function readIdentifier(start) {
    let position = start;
    while (position < length) {
      const character = source[position];
      if (/[A-Za-z0-9_$]/.test(character)) {
        position += 1;
      } else {
        break;
      }
    }
    return position;
  }

  while (index < length) {
    const character = source[index];

    if (character === "/" && source[index + 1] === "/") {
      const start = index;
      while (index < length && source[index] !== "\n") {
        index += 1;
      }
      mask(start, index);
      continue;
    }

    if (character === "/" && source[index + 1] === "*") {
      const start = index;
      index += 2;
      while (index < length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1;
      }
      index = Math.min(length, index + 2);
      mask(start, index);
      continue;
    }

    if (character === "\"" || character === "'") {
      const quote = character;
      const start = index;
      index += 1;
      while (index < length) {
        const inner = source[index];
        if (inner === "\\") {
          index += 2;
          continue;
        }
        if (inner === quote) {
          index += 1;
          break;
        }
        if (inner === "\n") {
          break;
        }
        index += 1;
      }
      mask(start, index);
      lastSignificantToken = "string";
      continue;
    }

    if (character === "`") {
      const start = index;
      index += 1;
      while (index < length) {
        const inner = source[index];
        if (inner === "\\") {
          index += 2;
          continue;
        }
        if (inner === "$" && source[index + 1] === "{") {
          mask(start, index);
          let depth = 1;
          output[index] = " ";
          output[index + 1] = " ";
          index += 2;
          const exprStart = index;
          while (index < length && depth > 0) {
            const expressionChar = source[index];
            if (expressionChar === "{") {
              depth += 1;
            } else if (expressionChar === "}") {
              depth -= 1;
              if (depth === 0) {
                break;
              }
            } else if (expressionChar === "`") {
              const nested = readNestedTemplate(source, index, output);
              index = nested;
              continue;
            } else if (expressionChar === "\"" || expressionChar === "'") {
              const nestedQuote = expressionChar;
              let scan = index + 1;
              while (scan < length) {
                if (source[scan] === "\\") {
                  scan += 2;
                  continue;
                }
                if (source[scan] === nestedQuote || source[scan] === "\n") {
                  scan += 1;
                  break;
                }
                scan += 1;
              }
              mask(index, scan);
              index = scan;
              continue;
            }
            output[index] = expressionChar;
            index += 1;
          }
          if (source[index] === "}") {
            output[index] = " ";
            index += 1;
          }
          mask(exprStart, exprStart);
          continue;
        }
        if (inner === "`") {
          index += 1;
          break;
        }
        index += 1;
      }
      mask(start, index);
      lastSignificantToken = "string";
      continue;
    }

    if (character === "/" && canStartRegex(lastSignificantToken)) {
      const start = index;
      index += 1;
      let inClass = false;
      while (index < length) {
        const inner = source[index];
        if (inner === "\\") {
          index += 2;
          continue;
        }
        if (inner === "[") {
          inClass = true;
        } else if (inner === "]") {
          inClass = false;
        } else if (inner === "/" && !inClass) {
          index += 1;
          while (index < length && /[gimsuy]/.test(source[index])) {
            index += 1;
          }
          break;
        } else if (inner === "\n") {
          break;
        }
        index += 1;
      }
      mask(start, index);
      lastSignificantToken = "regex";
      continue;
    }

    if (/[A-Za-z_$]/.test(character)) {
      const start = index;
      index = readIdentifier(index);
      copy(start, index);
      lastSignificantToken = source.slice(start, index);
      continue;
    }

    if (/\s/.test(character)) {
      output[index] = character;
      index += 1;
      continue;
    }

    output[index] = character;
    if (!/[\s)\]}]/.test(character)) {
      lastSignificantToken = character;
    }
    index += 1;
  }

  return output.join("");
}

function canStartRegex(lastToken) {
  if (!lastToken) {
    return true;
  }
  if (lastToken === "string" || lastToken === "regex") {
    return false;
  }
  if (/^[A-Za-z_$]/.test(lastToken)) {
    return KEYWORDS_BEFORE_REGEX.has(lastToken);
  }
  return ![")", "]", "++", "--"].includes(lastToken);
}

function readNestedTemplate(source, startIndex, output) {
  const length = source.length;
  let index = startIndex + 1;
  while (index < length) {
    const character = source[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "`") {
      index += 1;
      break;
    }
    index += 1;
  }
  for (let position = startIndex; position < index; position += 1) {
    output[position] = source[position] === "\n" || source[position] === "\r" ? source[position] : " ";
  }
  return index;
}
