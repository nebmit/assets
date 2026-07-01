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

# Set working directory
WORKDIR /app

# Copy built application from builder stage
COPY --from=builder /app/build build/
COPY --from=builder /app/drizzle drizzle/
COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/package.json .
COPY --from=builder /usr/bin/dumb-init /usr/bin/dumb-init

# Expose port
EXPOSE 3000

# Use dumb-init for proper signal handling
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start the application
CMD ["node", "build"]
