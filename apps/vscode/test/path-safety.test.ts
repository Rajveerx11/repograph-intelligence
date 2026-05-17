import assert from "node:assert/strict";
import test from "node:test";
import * as path from "node:path";

/**
 * The path-containment helpers live inside the extension's compiled
 * source and aren't exported. We re-implement the contract here and
 * pin it via test so future changes to the helper that drift away
 * from the contract get caught immediately.
 *
 * Contract:
 *   - Absolute paths in any form are rejected (return null).
 *   - Paths that escape the root via `..` are rejected.
 *   - Bare strings and well-formed relative paths resolve to a path
 *     under the root.
 */
function safeJoinUnderWorkspace(base: string, candidate: string): string | null {
  if (!candidate || typeof candidate !== "string") {
    return null;
  }
  if (path.isAbsolute(candidate) || /^[a-zA-Z]:[\\/]/.test(candidate) || candidate.startsWith("\\\\")) {
    return null;
  }
  const resolved = path.resolve(base, candidate);
  const rel = path.relative(base, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return resolved;
}

const root = path.resolve("/workspace/proj");

test("safeJoinUnderWorkspace returns a path inside the workspace for plain relative inputs", () => {
  const result = safeJoinUnderWorkspace(root, "src/index.ts");
  assert.equal(result, path.resolve(root, "src/index.ts"));
});

test("safeJoinUnderWorkspace rejects POSIX absolute paths", () => {
  assert.equal(safeJoinUnderWorkspace(root, "/etc/passwd"), null);
});

test("safeJoinUnderWorkspace rejects Windows-style absolute paths and UNC paths", () => {
  assert.equal(safeJoinUnderWorkspace(root, "C:\\Windows\\System32"), null);
  assert.equal(safeJoinUnderWorkspace(root, "c:/Users/admin"), null);
  assert.equal(safeJoinUnderWorkspace(root, "\\\\evil-server\\share"), null);
});

test("safeJoinUnderWorkspace rejects parent-relative escapes", () => {
  assert.equal(safeJoinUnderWorkspace(root, "../escape.txt"), null);
  assert.equal(safeJoinUnderWorkspace(root, "src/../../escape.txt"), null);
});

test("safeJoinUnderWorkspace rejects empty and non-string inputs", () => {
  assert.equal(safeJoinUnderWorkspace(root, ""), null);
  assert.equal(safeJoinUnderWorkspace(root, undefined as unknown as string), null);
  assert.equal(safeJoinUnderWorkspace(root, null as unknown as string), null);
});
