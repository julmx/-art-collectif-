FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS app
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/* && mkdir /data && chown node:node /data
COPY --from=build --chown=node:node /app /app
USER node
ENV NODE_ENV=production DATA_DIR=/data HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["npm","run","server"]

FROM caddy:2 AS web
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
