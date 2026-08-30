FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=8080 \
    ALLOW_CONTAINER_BIND=true \
    STATIC_DIR=/app/dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/api-dist ./api-dist
COPY --from=build /app/dist ./dist
COPY --from=build /app/db ./db
EXPOSE 8080
USER node
CMD ["node", "api-dist/server.js"]
