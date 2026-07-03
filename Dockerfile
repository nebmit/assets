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
