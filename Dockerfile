
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

# `npm ci` requires a lockfile and installs from it exactly — same tree as
# `node_modules` locally, no version drift. `--no-audit --no-fund` just
# trims the CI log noise.
RUN npm ci --no-audit --no-fund

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
