# CLINISCOPE shared-workspace API server.
# Build: docker build -t cliniscope-api .
# Run:   docker run -p 8787:8787 -v cliniscope-data:/data -e CLINISCOPE_ALLOWED_ORIGINS=https://<your-frontend> cliniscope-api
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY server ./server
COPY src/lib ./src/lib
RUN npx esbuild server/index.ts --bundle --platform=node --format=esm --target=node22 --packages=external --outfile=dist-server/server.mjs

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production CLINISCOPE_DATA_DIR=/data PORT=8787
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist-server ./dist-server
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "dist-server/server.mjs"]
