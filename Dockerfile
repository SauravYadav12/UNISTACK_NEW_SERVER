
# ────────────────────────────────────────────────────────────────────────────
# Base Stage: install deps + build TypeScript
# ────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app

# Copy BOTH package.json and package-lock.json first so Docker caches the
# dependency install layer — and so `npm ci` can enforce an exact match to
# the lockfile instead of re-resolving (which was pulling newer transitive
# types on the build server and breaking `new Types.ObjectId(id)` and
# `schema.index(..., { unique: true })`).
COPY package.json package-lock.json ./

# Install strategy:
#   1. Try `npm ci` first — it installs the exact tree from the lockfile,
#      keeping Docker builds deterministic (this is what avoided the
#      Mongoose/ObjectId type drift we hit earlier).
#   2. If `npm ci` fails (usually because package.json drifted from
#      package-lock.json — someone committed package.json without
#      regenerating the lockfile), fall back to `npm install` so the
#      deploy still goes through. We log a WARN so the drift is visible in
#      the build output and can be cleaned up on the next lockfile commit.
#
# Keeps the deterministic-build benefit on the happy path without making
# lockfile-sync mistakes a hard deploy blocker.
RUN npm ci --no-audit --no-fund \
  || ( \
    echo "⚠️  npm ci failed (package.json / package-lock.json out of sync). Falling back to npm install. Resync the lockfile locally and commit it to restore deterministic builds." \
    && npm install --no-audit --no-fund \
  )

# Now copy the application source. A sibling .dockerignore keeps local
# node_modules, .git, dist, and env files out of this layer.
COPY . .

# Build the TypeScript application
RUN npm run build

# ────────────────────────────────────────────────────────────────────────────
# Production Stage: slim runtime image with only what's needed to serve
# ────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Carry over the already-installed node_modules (matches the lockfile),
# the manifest, and the compiled dist from the base stage.
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/package-lock.json ./package-lock.json
COPY --from=base /app/dist ./dist

# Expose the port that the application listens on
EXPOSE 8080

# Start the application
CMD ["npm", "run", "start"]
