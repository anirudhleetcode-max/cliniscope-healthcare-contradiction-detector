# MEDGUARD shared-workspace API server.
# Build: docker build -t medguard-api .
# Run with an external PostgreSQL database (free hosting: the container disk is NOT persistent):
#   docker run -p 8787:8787 -e DATABASE_URL=postgresql://... -e MEDGUARD_REQUIRE_DATABASE_URL=true \
#          -e MEDGUARD_ALLOWED_ORIGINS=https://<your-frontend-host> medguard-api
# Or self-host with the embedded database on a persistent volume:
#   docker run -p 8787:8787 -v medguard-data:/data -e MEDGUARD_ALLOWED_ORIGINS=https://<your-frontend-host> medguard-api
# The server is bundled into one file; the only runtime package is the embedded database (PGlite),
# which is loaded only when DATABASE_URL is not set.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY server ./server
COPY src/lib ./src/lib
RUN npm run server:build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production MEDGUARD_DATA_DIR=/data PORT=8787 HOST=0.0.0.0
COPY --from=build /app/dist-server/server.mjs ./server.mjs
COPY --from=build /app/node_modules/@electric-sql/pglite ./node_modules/@electric-sql/pglite
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
