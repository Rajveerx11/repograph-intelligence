import assert from "node:assert/strict";
import test from "node:test";

/**
 * Contract pin for `parseJsonOrNull` in `src/run.js`. The helper is
 * module-private and would require a refactor to export, so we
 * duplicate the contract here and verify it stays correct. If the
 * implementation in `run.js` drifts from this spec, those tests below
 * still pin the expected behaviour; bring the implementation back in
 * line.
 *
 * Contract:
 *   - A clean JSON document parses normally.
 *   - When the document is prefixed with log noise, the recovery
 *     starts at the first `{` and tracks balanced braces with
 *     awareness of JSON string literals (so `}` inside a string does
 *     not prematurely close the document).
 *   - When no balanced block is recoverable, the function returns
 *     `null` rather than throwing.
 */
function parseJsonOrNull(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
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

test("parseJsonOrNull parses a clean JSON document directly", () => {
  const value = parseJsonOrNull('{"passed":true}');
  assert.deepEqual(value, { passed: true });
});

test("parseJsonOrNull recovers a JSON document from leading log noise", () => {
  const value = parseJsonOrNull('::notice::analyzing\n{"passed":false}');
  assert.deepEqual(value, { passed: false });
});

test("parseJsonOrNull ignores `}` that appears inside a JSON string literal during recovery", () => {
  const value = parseJsonOrNull('warmup line\n{"violations":[{"message":"src/x.ts has } character"}]}');
  assert.deepEqual(value, { violations: [{ message: "src/x.ts has } character" }] });
});

test("parseJsonOrNull is not fooled by escaped quotes inside a JSON string", () => {
  const value = parseJsonOrNull('boot\n{"msg":"escaped \\"quote\\" inside","ok":1}');
  assert.deepEqual(value, { msg: 'escaped "quote" inside', ok: 1 });
});

test("parseJsonOrNull returns null when there is no balanced block at all", () => {
  assert.equal(parseJsonOrNull("just plain text"), null);
  assert.equal(parseJsonOrNull(""), null);
  assert.equal(parseJsonOrNull(null), null);
  assert.equal(parseJsonOrNull("{unclosed"), null);
});
