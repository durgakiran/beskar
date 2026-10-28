FROM postgres:16-bookworm@sha256:d81f7b51697014367236d07ec58b54153fc28f828b72bf247fe5c7487520bcb0

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl postgresql-16-pgvector=0.8.7-1.pgdg12+1 \
 && arch="$(dpkg --print-architecture)" \
 && curl -fL --retry 2 "https://github.com/paradedb/paradedb/releases/download/v0.26.3/postgresql-16-pg-search_0.26.3-1PARADEDB-bookworm_${arch}.deb" -o /tmp/pg_search.deb \
 && sha256sum /tmp/pg_search.deb \
 && apt-get install -y --no-install-recommends /tmp/pg_search.deb \
 && rm /tmp/pg_search.deb \
 && rm -rf /var/lib/apt/lists/*
