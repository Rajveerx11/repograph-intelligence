# syntax=docker/dockerfile:1.7

# RepoGraph Intelligence Docker image
#
# Build:
#   docker build -t repograph/intelligence:0.2.0 .
#
# Usage:
#   docker run --rm -v "$(pwd):/repo" repograph/intelligence analyze /repo
#   docker run --rm -v "$(pwd):/repo" repograph/intelligence policy /repo --policy /repo/.repograph/policy.json
#   docker run --rm -v "$(pwd):/repo" repograph/intelligence drift /repo --baseline /repo/.repograph/baseline.json
#
# The container's working directory is `/repo` so any volume mount that
# lands a project there gets analyzed cleanly. Custom paths still work.

# ---- builder stage --------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Install production-only dependency tree first so the resulting layer can
# be reused when source changes but package metadata does not.
COPY package.json package-lock.json* ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages ./packages
# Run install AFTER copying every workspace's package.json so the
# npm-workspaces graph resolves correctly. `--ignore-scripts` keeps
# arbitrary postinstall scripts in transitive deps from running at
# image-build time.
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund

# Copy the rest of the project. Tests, fixtures, and the Rust workspace
# are excluded via `.dockerignore` so the final image stays slim.
COPY apps ./apps
COPY README.md LICENSE CHANGELOG.md ./
COPY examples ./examples

# ---- runtime stage --------------------------------------------------------
FROM node:22-alpine AS runtime

# Run as a non-root user for defence-in-depth — the CLI never needs to
# write outside the bind-mounted `/repo` directory.
RUN addgroup -S repograph && adduser -S repograph -G repograph

WORKDIR /app

COPY --from=builder /app /app

# Drop privileges before the entrypoint runs. The mounted `/repo` must
# be world-readable for analysis to succeed.
USER repograph

# Default workdir for invocations — most users mount their project here.
WORKDIR /repo

ENTRYPOINT ["node", "/app/packages/cli/src/index.js"]
CMD ["help"]
