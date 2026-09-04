# syntax=docker/dockerfile:1
# AgentCore Runtime image for the bridge agent. Build context is the repo root:
#   docker build --platform linux/arm64 -f packages/agent/Dockerfile -t alexa-mcp-bridge-agent .
# Stage 1 compiles core and agent; the final stage ships dist, prompts, and production deps only (plan D17).
# Alpine base and --omit=optional: Strands' optional @tobilu/qmd would add node-llama-cpp and TypeScript (40 MB).
# The image must be linux/arm64; an x86 image fails silently on AgentCore.

FROM --platform=linux/arm64 node:22-alpine AS manifests
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/tsconfig.json packages/core/
COPY packages/agent/package.json packages/agent/tsconfig.json packages/agent/tsconfig.build.json packages/agent/
# npm ci needs every workspace listed in the lockfile to exist; the others only need their manifest.
COPY packages/cli/package.json packages/cli/
COPY packages/generator/package.json packages/generator/
COPY packages/skill-lambda/package.json packages/skill-lambda/
COPY infra/package.json infra/
COPY examples/sample-mcp-server/package.json examples/sample-mcp-server/

FROM manifests AS build
RUN npm ci --no-audit --no-fund --include-workspace-root --workspace packages/core --workspace packages/agent
COPY packages/core/src packages/core/src
COPY packages/agent/src packages/agent/src
RUN npx tsc -b packages/agent/tsconfig.build.json

FROM manifests AS production-deps
RUN npm ci --no-audit --no-fund --omit=dev --omit=optional --workspace packages/core --workspace packages/agent \
 && npm cache clean --force

FROM --platform=linux/arm64 node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=production-deps /repo/package.json ./
COPY --from=production-deps /repo/node_modules node_modules
COPY --from=production-deps /repo/packages/core/package.json packages/core/package.json
COPY --from=production-deps /repo/packages/agent/package.json packages/agent/package.json
COPY --from=build /repo/packages/core/dist packages/core/dist
COPY --from=build /repo/packages/agent/dist packages/agent/dist
COPY packages/agent/prompts packages/agent/prompts
USER node
EXPOSE 8080
CMD ["node", "packages/agent/dist/main.js"]
