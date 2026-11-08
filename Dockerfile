FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:web

FROM rust:bookworm AS backend
WORKDIR /app
COPY src-tauri ./src-tauri
RUN cargo build --locked --release --manifest-path src-tauri/Cargo.toml --no-default-features --features web --bin coolapk-web

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --user-group --uid 10001 coolapk \
    && install -d -m 0700 -o coolapk /var/lib/coolapk-web
WORKDIR /app
COPY --from=backend /app/src-tauri/target/release/coolapk-web /usr/local/bin/coolapk-web
COPY --from=frontend /app/dist-web ./dist-web
COPY --chmod=755 scripts/docker-web-entrypoint.sh /usr/local/bin/docker-web-entrypoint
ENV COOLAPK_WEB_DATA_DIR=/var/lib/coolapk-web
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/docker-web-entrypoint"]
CMD ["coolapk-web"]
