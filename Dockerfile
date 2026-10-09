# MEDGUARD shared-workspace API server.
# Build: docker build -t cliniscope-api .
# Run:   docker run -p 8787:8787 -v cliniscope-data:/data \
#          -e CLINISCOPE_ALLOWED_ORIGINS=https://anirudhleetcode-max.github.io cliniscope-api
# The server is bundled into ONE self-contained file, so the runtime image has no node_modules.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY server ./server
COPY src/lib ./src/lib
RUN npm run server:build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production CLINISCOPE_DATA_DIR=/data PORT=8787 HOST=0.0.0.0
COPY --from=build /app/dist-server/server.mjs ./server.mjs
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
