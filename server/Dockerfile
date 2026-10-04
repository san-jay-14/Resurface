# syntax=docker/dockerfile:1
# Build context: ./server (render.yaml sets rootDir). Two stages so the runtime image carries only
# production dependencies and compiled output.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# ffmpeg is only needed for the optional video rung of the frames ladder (FFMPEG_ENABLED=true); it
# is left out by default to keep the image small and the free-tier cold start fast.
ARG INSTALL_FFMPEG=false
RUN if [ "$INSTALL_FFMPEG" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*; \
    fi
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY migrations ./migrations
COPY public ./public
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
