# Build Stage - use standard Node.js for build
FROM node:22-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends dumb-init && rm -rf /var/lib/apt/lists/*

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

# Create runtime directories here: the Chainguard runtime has no shell.
RUN mkdir -p /data/raw

# Runtime dependencies only; prepare requires build tools and must not run here.
FROM node:22-bookworm-slim AS production-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Production stage - use Chainguard for runtime security
FROM cgr.dev/chainguard/node:latest AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Docker named volumes inherit this ownership on first use.
COPY --chown=65532:65532 --from=builder /data /data

# Copy built application from builder stage
COPY --chown=65532:65532 --from=builder /app/build build/
COPY --chown=65532:65532 --from=builder /app/drizzle drizzle/
COPY --chown=65532:65532 --from=production-deps /app/node_modules node_modules/
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
FROM python:3.12-slim-bookworm AS worker
COPY --from=builder /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends dumb-init ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY scripts/xbrl/requirements.lock scripts/xbrl/requirements.lock
# Use one patched installer rather than bootstrapping another old pip into the venv.
RUN python3 -m pip install --no-cache-dir --upgrade pip==26.2.2 \
	&& python3 -m venv --without-pip /app/.venv-xbrl \
	&& python3 -m pip --python /app/.venv-xbrl install --no-cache-dir -r scripts/xbrl/requirements.lock
# No package installer (or its vendored dependencies) is needed at runtime.
RUN python3 -m pip --python /app/.venv-xbrl check && python3 -m pip uninstall --yes pip
COPY --from=builder /app/build build/
COPY --from=builder /app/drizzle drizzle/
COPY --from=production-deps /app/node_modules node_modules/
COPY --from=builder /app/package.json .
COPY scripts/xbrl scripts/xbrl/
RUN mkdir -p /data/raw && chown -R 65532:65532 /data /app
USER 65532:65532
ENV NODE_ENV=production
ENV XBRL_PYTHON=/app/.venv-xbrl/bin/python
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "build/worker.js", "schedule"]

# Preserve the existing default web image; build the worker with --target worker.
FROM runtime AS web
