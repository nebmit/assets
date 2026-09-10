# Build Stage - use standard Node.js for build
FROM node:22-bookworm-slim AS builder

# Install security updates and dumb-init
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

RUN npx svelte-kit sync

# Build the application (web server + worker bundle)
RUN npm run build

# Production stage - use Chainguard for runtime security
FROM cgr.dev/chainguard/node:latest AS runtime

# Prepare writable runtime paths as root, then drop to the non-root Chainguard
# user. Docker named volumes inherit the target directory ownership on first use.
USER 0

# Set working directory
WORKDIR /app

RUN mkdir -p /data/raw && chown -R 65532:65532 /app /data

# Copy built application from builder stage
COPY --chown=65532:65532 --from=builder /app/build build/
COPY --chown=65532:65532 --from=builder /app/drizzle drizzle/
COPY --chown=65532:65532 --from=builder /app/node_modules node_modules/
COPY --chown=65532:65532 --from=builder /app/package.json .
COPY --from=builder /usr/bin/dumb-init /usr/bin/dumb-init

# Run as the standard Chainguard non-root UID.
USER 65532:65532

# Expose port
EXPOSE 3000

# Use dumb-init for proper signal handling
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start the application
CMD ["node", "build"]

# Explicit worker image: Python and Node share a Debian runtime; the web target above stays unchanged.
FROM python:3.12.4-slim-bookworm AS worker
COPY --from=builder /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY scripts/xbrl/requirements.lock scripts/xbrl/requirements.lock
RUN python3 -m venv /app/.venv-xbrl && /app/.venv-xbrl/bin/pip install --no-cache-dir -r scripts/xbrl/requirements.lock
COPY --from=builder /app/build build/
COPY --from=builder /app/drizzle drizzle/
COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/package.json .
COPY scripts/xbrl scripts/xbrl/
RUN mkdir -p /data/raw && chown -R 65532:65532 /data /app
USER 65532:65532
ENV XBRL_PYTHON=/app/.venv-xbrl/bin/python
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "build/worker.js", "schedule"]

# Preserve the existing default web image; build the worker with --target worker.
FROM runtime AS web
