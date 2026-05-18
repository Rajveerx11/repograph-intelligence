# RepoGraph Intelligence — GitHub Action

Composite GitHub Action that runs every RepoGraph CI gate on a pull request and posts a sticky verdict comment. One step in your workflow, four structural-quality gates wired up:

- **Architecture Policy** — fails on declared invariant violations (status `2`)
- **API Surface Diff** — fails on breaking export changes (status `3`)
- **Drift Gate** — fails on new cycles / dependency growth past your baseline thresholds (status `4`)
- **Test Selection** — informational; lists the minimum test set that exercises the PR diff

The action installs the canonical [`repograph-intelligence`](https://www.npmjs.com/package/repograph-intelligence) CLI, analyzes the PR head, runs each enabled gate, and posts a single Markdown comment summarising the result. The comment updates in place on subsequent pushes so the PR conversation stays clean.

## Quick start

Add `.github/workflows/repograph.yml`:

```yaml
name: RepoGraph PR gates
on:
  pull_request:
    branches: [main]

permissions:
  contents: read
  pull-requests: write

jobs:
  repograph:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0           # needed for accurate diff detection
      - uses: Rajveerx11/repograph-intelligence/apps/github-action@v0.4.0
        with:
          policy-path: .repograph/policy.json
          baseline-path: .repograph/baseline.json
          base-graph-path: .repograph/base-graph.json
```

The first run will skip gates whose input files do not exist yet — start by committing a `policy.json`, then a `baseline.json`, then a `base-graph.json` as your project hardens its structural guardrails.

## Inputs

| Input | Default | Description |
|---|---|---|
| `policy-path` | `.repograph/policy.json` | Workspace-relative policy file. Empty string skips the policy gate. |
| `baseline-path` | `.repograph/baseline.json` | Workspace-relative baseline snapshot. Empty string skips the drift gate. |
| `base-graph-path` | (empty) | Workspace-relative base graph for api-diff. Empty string skips the api-diff gate. |
| `changed-files` | (auto-detected) | Comma-separated list of changed files. When empty the action calls `git diff --name-only base...head`. |
| `fail-on-policy` | `true` | When `true`, the job fails on policy violations meeting `--fail-on error`. |
| `fail-on-breaking` | `true` | When `true`, the job fails when the API surface has any removed or changed exports. |
| `fail-on-drift` | `true` | When `true`, the job fails when the drift gate's thresholds break. |
| `comment-mode` | `update` | Either `update` (single sticky comment, recommended) or `append` (new comment every run). |
| `node-version` | `22` | Node.js version installed for the CLI. |
| `cli-package` | `repograph-intelligence@latest` | npm spec for the CLI. Pin to a version (e.g. `repograph-intelligence@0.3.0`) for deterministic CI. |
| `github-token` | `${{ github.token }}` | Token used to post the comment. The default workflow token is sufficient. |

## Outputs

| Output | Description |
|---|---|
| `verdict` | Either `pass` or `fail`. |
| `comment-url` | URL of the posted verdict comment. Empty if posting failed. |

## Exit codes

The action mirrors the CLI's exit-code contract so a downstream step can tell which gate fired:

| Code | Trigger |
|---|---|
| `0` | All enabled gates passed (the verdict is still posted). |
| `2` | Policy gate failed and `fail-on-policy` is `true`. |
| `3` | API-diff gate failed and `fail-on-breaking` is `true`. |
| `4` | Drift gate failed and `fail-on-drift` is `true`. |

## Security posture

- The action only ever calls the GitHub REST API at `api.github.com` and the public npm registry to install the CLI. No third-party endpoints.
- The custom GitHub client refuses to follow redirects and refuses to follow `Link` headers that point outside `api.github.com`, so a hostile API response cannot leak the workflow token.
- Workspace-relative inputs (`policy-path`, `baseline-path`, `base-graph-path`) are validated with a `path.relative` containment check; absolute paths or `..`-escapes are rejected before any file read.
- The CLI is installed with `--no-audit --no-fund`. Pin the `cli-package` input to a specific version for fully deterministic builds.
- Workflow permissions stay at `contents: read` + `pull-requests: write` — the action never needs anything broader.
- The verdict comment is rendered from JSON CLI output via pure formatters that escape pipes, backticks, and newlines before they enter Markdown tables, so adversarial file names cannot break the rendered comment.

## Local testing

The pure formatter logic and the REST client are covered by Node test-runner unit tests:

```bash
cd apps/github-action
node --test test/*.test.js
```

The tests mock `globalThis.fetch` to verify the redirect-refusal, link-header host check, and Markdown table generation without touching the network.
