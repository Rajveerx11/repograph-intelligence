# Contributing to RepoGraph Intelligence

Thanks for your interest in contributing. RepoGraph Intelligence is early, intentionally small, and focused on one core idea: structural repository intelligence should be explainable, local-first, and useful to both developers and AI systems.

## What To Work On

High-value contribution areas:

- Parser support for more language constructs
- Tree-sitter-backed extraction in the Rust parser engine
- Graph algorithms for coupling, cycles, ownership, and impact analysis
- Architecture rules and recommendation quality
- MCP tool ergonomics
- React Flow graph explorer workflows
- Rust storage and traversal hardening
- CLI output formats for CI and pull request workflows
- Test fixtures that model real repository shapes
- Documentation, examples, and graph schema notes

## Development Setup

Requirements:

- Node.js 20 or newer
- npm
- Git
- Rust toolchain (`cargo`, `rustc`) for Rust core changes

Install and verify:

```bash
npm test
npm run check
npm run web:build
```

Run the CLI locally:

```bash
npm run repograph -- help
```

## Pull Request Guidelines

Before opening a pull request:

1. Keep the change focused on one behavior or capability.
2. Add or update tests for graph behavior, CLI behavior, or intelligence outputs.
3. Run `npm run check`, `npm test`, and `npm run web:build`.
4. Update `README.md` or docs when user-facing behavior changes.
5. Describe the repository behavior being modeled and any tradeoffs in the implementation.

For Rust core changes, also run:

```bash
cargo test --workspace
```

## Code Style

- Prefer small modules with explicit exports.
- Keep analysis outputs structured and machine-readable where possible.
- Preserve local-first behavior; do not require cloud credentials for core features.
- Favor deterministic heuristics before introducing model-backed behavior.
- Avoid broad refactors unless they are required for the feature.

## Reporting Issues

When opening an issue, include:

- The repository language or framework involved
- The command you ran
- Expected behavior
- Actual behavior
- A small reproduction or fixture when possible

## Security

RepoGraph currently performs local static analysis and does not claim to detect known vulnerable package versions. Security-related features focus on architecture risk, sensitive blast zones, dependency exposure, and coupling patterns.

If you discover a security issue in RepoGraph itself, please open a private report through GitHub security advisories if available, or contact the maintainers before public disclosure.

## License

By contributing, you agree that your contributions are licensed under the MIT License.
