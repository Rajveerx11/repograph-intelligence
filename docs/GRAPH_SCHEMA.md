# RepoGraph Graph Schema

This document describes the current JSON graph and snapshot contracts. The schema is intentionally small while the project is still in early development, but the fields below are treated as public CLI/API output.

## Graph

Graphs are produced by:

```bash
npm run repograph -- graph ./repo
```

Top-level fields:

| Field | Type | Description |
| --- | --- | --- |
| `version` | number | Graph schema version. Current value: `1`. |
| `generatedAt` | string | ISO timestamp for graph generation. |
| `root` | string | Absolute repository root analyzed. |
| `nodes` | array | File, symbol, and package nodes. |
| `edges` | array | Containment, import, and dependency edges. |

## Node Types

| Type | Required fields | Description |
| --- | --- | --- |
| `file` | `id`, `type`, `label`, `path`, `language` | Source file discovered by the scanner. |
| `function` | `id`, `type`, `label`, `path`, `language` | Function or method-like symbol. |
| `class` | `id`, `type`, `label`, `path`, `language` | Class symbol. |
| `interface` | `id`, `type`, `label`, `path`, `language` | TypeScript interface symbol. |
| `package` | `id`, `type`, `label` | External package dependency. |

File nodes may also include:

- `lineCount`
- `semanticText`
- `symbolCount`

## Edge Types

| Type | Required fields | Description |
| --- | --- | --- |
| `contains` | `id`, `type`, `from`, `to` | A file contains a symbol. |
| `imports` | `id`, `type`, `from`, `to`, `scope` | A file imports another internal file. |
| `dependency` | `id`, `type`, `from`, `to`, `scope` | A file depends on an external package. |

Dependency edges include:

- `specifier`: the import specifier found in source
- `scope`: `internal` or `external`

## Snapshot

Snapshots are produced by:

```bash
npm run repograph -- snapshot ./repo --out .repograph/snapshot.json
```

Snapshots are designed for CI and baseline comparison. They contain stable file profiles instead of the full graph.

Top-level fields:

| Field | Type | Description |
| --- | --- | --- |
| `version` | number | Snapshot schema version. Current value: `1`. |
| `schema` | string | Snapshot schema id. Current value: `repograph.snapshot.v1`. |
| `generatedAt` | string | ISO timestamp for snapshot generation. |
| `root` | string | Repository root from the graph. |
| `graphVersion` | number | Source graph version. |
| `validation` | object | Graph validation result. |
| `fingerprint` | string | Stable snapshot fingerprint. |
| `metrics` | object | Repository metrics at snapshot time. |
| `files` | array | Stable file profiles. |
| `packages` | array | External package labels. |
| `circularDependencies` | array | Circular dependency paths. |

## Validation

Validation checks:

- graph version presence
- node and edge arrays
- duplicate node ids
- duplicate edge ids
- duplicate file paths
- missing node types
- missing file paths
- edges pointing to missing nodes
- dependency edges without scope

Run validation with:

```bash
npm run repograph -- validate ./repo
```

## Compatibility Notes

The current schema is optimized for inspectability and deterministic tests. Future storage engines may persist this structure in SQLite or another indexed format, but CLI and MCP outputs should continue to expose these contracts or a versioned successor.
