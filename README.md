# Teddox / Beskar

Teddox is a collaborative document and whiteboard application. This repository
contains the React UI, Go API server, collaboration signaling server, desktop
client, database migrations, and Docker deployment configuration.

## Deployment requirements

Both local and production deployments use
[`docker/scripts/deploy.sh`](docker/scripts/deploy.sh), with a separate env file
for each environment. Run the commands below from the repository root.

You need:

- Docker with the Docker Compose v2 plugin, and Bash with standard Unix tools.
- A GitHub Packages token (`NPM_TOKEN`) that can read the `@durgakiran` packages
  used by the UI build.
- Application, authentication, and landing-site hostnames that resolve to the
  deployment host, plus TLS certificate/key files when HTTPS is enabled.
- Zitadel application credentials and a user PAT, Permify configuration, and
  S3-compatible upload storage credentials.

Docker builds include the Go/Node toolchains, WebAssembly, and Liquibase. You do
not need to install Java, Gradle, Liquibase, PostgreSQL, Go, or Node on the host
just to deploy the stack. For host-side package development, use Node.js 22+
with npm 10+; the Go workspace requires Go 1.25+.

## Configure an environment

Create the file for the environment you want to run:

```bash
# Local deployment
cp docker/env/deploy.env.example docker/env/local.env

# Production deployment
cp docker/env/deploy.env.example docker/env/prod.env
```

Edit the selected file before deploying. The
[env template](docker/env/deploy.env.example) lists the available settings.
Environment files are sourced by Bash, so quote values containing shell special
characters. Real env files and generated deployment configuration are ignored
by Git.

| Settings | Configuration |
| --- | --- |
| `COMPOSE_PROJECT_NAME`, `DOCKER_NETWORK_NAME` | Use different names for local and production, such as `beskar-local` / `beskar-local-network` and `beskar-prod` / `beskar-prod-network`. |
| `APP_DOMAIN`, `AUTH_DOMAIN`, `LANDING_DOMAIN` | Set hostnames for the app, Zitadel, and landing site. Local names need host/DNS entries; production names need DNS records. |
| `TLS_ENABLED`, `TLS_CERT_PATH`, `TLS_KEY_PATH` | HTTPS is the default. Paths must refer to certificate/key files on the Docker host. Local browsers and services must trust the local certificate. |
| `PROXY_HTTP_PORT`, `PROXY_HTTPS_PORT` | Published proxy ports, defaulting to 80 and 443. Separate simultaneous stacks need distinct ports. If using nonstandard public ports, set the corresponding public URL overrides explicitly. |
| `POSTGRES_DATA_MOUNT` | Choose persistent storage for this environment. Different Compose project names do **not** isolate a shared bind-mount path. Relative paths resolve from `docker/.generated/`. |
| `DB_ROOT_*`, `DB_ADMIN_*`, `DB_APP_*` | Set database names/credentials for initialization and application access. Keep `DB_HOST=postgres` and `DB_PORT=5432` for the bundled database. |
| `DB_SEARCH_NAME`, `DB_SEARCH_WRITER_USER`, `DB_SEARCH_WRITER_USER_PWD` | Separate search database and writer role. Defaults are `search` and `search_writer`; the password is required. |
| `REDIS_PASSWORD`, `PERMIFY_SECRET`, `NEXTAUTH_SECRET` | Set environment-specific secrets. |
| `ZITADEL_*` | Configure the issuer, client ID/secret, project audience, user PAT, admin credentials, and independent 32-byte master/session keys. `ZITADEL_BEARER_CLIENT_IDS` is required and lists allowed bearer OAuth client IDs. |
| `STORAGE_S3_*` | Configure the upload bucket, endpoint, region, and access credentials. |
| `NPM_TOKEN` | Token used to install private packages during UI builds. |

Public URLs are derived from the domains and `TLS_ENABLED` unless overridden.
For local use, route all three hostnames to the local machine and ensure
containers can reach the configured Zitadel issuer. The
`PROXY_DOMAIN_ALIASES_ENABLED` option can route those names to the proxy inside
Docker. Use `ORIGIN_CERT_TRUST_INJECTION_ENABLED` only when the configured
certificate should also be injected into the application containers' trust
configuration.

HTTP templates are available with `TLS_ENABLED=false`, but browser sessions
normally require HTTPS. Use HTTPS for normal local sign-in testing.

The deploy script starts Zitadel but does not create your OAuth client, PAT, or
Permify authorization schema. Configure the Zitadel application for the chosen
public URLs, and apply the application's Permify schema before using permissioned
features. See the [Permify setup](docker/README.md#apply-the-permify-schema).
The bundled `guard` service is internal to Docker; use an appropriate access path
when applying that schema rather than assuming port 3476 is published on the host.

## Deploy locally or to production

Validate the chosen environment without starting services:

```bash
./docker/scripts/render-configs.sh --env docker/env/local.env
./docker/scripts/validate-config.sh --env docker/env/local.env
```

Deploy locally:

```bash
./docker/scripts/deploy.sh --env docker/env/local.env
```

Deploy to production:

```bash
./docker/scripts/deploy.sh --env docker/env/prod.env
```

The script renders and validates configuration, starts PostgreSQL and Redis,
runs the `db-init` job, then builds/starts `guard`, `zitadel`, `server`,
`signalserver`, `ui`, `launchsite`, and the nginx `proxy`.

Open the app at its configured public URL. API documentation is served at
`/api/docs`, with the OpenAPI specification at `/api/openapi.json`.

Generated files live in `docker/.generated/`. Change the env file or templates
and render again instead of editing generated files. Rendering another
environment overwrites that directory, so always render the intended environment
before running manual Compose commands. The older root Compose file and
`docker/database/db.sh` / `docker/app/app.sh` are legacy workflows.

## Common operations

The examples below assume `COMPOSE_PROJECT_NAME=beskar-local`. For production,
use `prod.env` and its configured project name instead.

```bash
# Render the intended environment before using the generated Compose file.
./docker/scripts/render-configs.sh --env docker/env/local.env

# Inspect services and recent logs.
docker compose -f docker/.generated/compose.yml -p beskar-local ps
docker compose -f docker/.generated/compose.yml -p beskar-local logs --tail=100 server ui proxy

# Rebuild/recreate only the API server after changing its code or env.
docker compose -f docker/.generated/compose.yml -p beskar-local \
  up -d --build --force-recreate --no-deps server

# Rebuild/recreate only the UI after UI code or build-time settings change.
docker compose -f docker/.generated/compose.yml -p beskar-local \
  up -d --build --force-recreate --no-deps ui

# Apply database migrations without redeploying the application.
docker compose -f docker/.generated/compose.yml -p beskar-local up -d postgres
docker compose -f docker/.generated/compose.yml -p beskar-local run --rm --build db-init

# Stop this environment without requesting volume removal.
docker compose -f docker/.generated/compose.yml -p beskar-local down
```

`db-init` provisions databases/roles and applies initialization, application,
and search Liquibase changelogs. Liquibase tracks applied changesets; rerunning
the job applies pending changes. Updating env credentials does not automatically
rotate passwords on existing database roles.

The database image is PostgreSQL 16 on Debian Bookworm with pg_search 0.26.3 and
pgvector 0.8.7. When moving from the older Alpine database, follow the
[database migration runbook](docs/runbooks/postgres-alpine-to-debian.md) and
restore into fresh storage before starting application writers.

## Populate and maintain document search

The search API is always registered for authenticated users and checks each
result against current publication state and user permissions. It reads the
separate search database using `PG_SEARCH_*`. In Docker these settings default
to the database host/port and search name/writer credentials configured above;
a separate `DATABASE_URL` is not needed inside the server container.

To keep new publications synchronized, set these in the deployment env and
redeploy all application instances:

```dotenv
SEARCH_SYNC_CAPTURE_ENABLED=true
SEARCH_SYNC_WORKER_ENABLED=true
```

These flags control capture and background processing, not API availability.
For already published documents, queue a backfill after migrations and deployment:

```bash
docker compose -f docker/.generated/compose.yml -p beskar-local \
  exec -T server searchsync -mode backfill

docker compose -f docker/.generated/compose.yml -p beskar-local \
  exec -T server searchsync -mode status
```

Backfill queues work; the worker populates the index. Monitor pending/failed
events rather than expecting the outbox to become empty, since completed events
remain recorded. See the [searchsync command guide](server/cmd/searchsync/README.md)
for manual batches, reconciliation, retries, and the full backfill procedure.
The [documentbodytext guide](server/cmd/documentbodytext/README.md) covers read-only
body-text exports; that command does not populate the search database.

## Use local package changes in Docker

Docker normally installs published UI packages. To test changes from this
checkout, install dependencies and build each package:

```bash
# Export NPM_TOKEN in your shell before installing private dependencies.
npm --prefix packages/editor ci
npm --prefix packages/editor run build
npm --prefix packages/glideline ci
npm --prefix packages/glideline run build
npm --prefix packages/canvas-text-editor ci
npm --prefix packages/canvas-text-editor run build
npm --prefix packages/glideboard ci
npm --prefix packages/glideboard run build
```

Set `UI_USE_LOCAL_PACKAGES_DIST=true` in the selected deployment env, then run
`deploy.sh` again. The UI image overlays those package outputs. Docker also
builds the editor PDF module, UI workers, and `jbi.wasm` automatically.

## Repository and further documentation

| Path | Purpose |
| --- | --- |
| `ui/` | React/Vite web application. |
| `server/` | Go HTTP APIs, document processing, search, and background workers. |
| `signalserver/` | Collaboration signaling service. |
| `packages/` | Editor, whiteboard, and shared drawing/text packages. |
| `jbi/` | Go WebAssembly module used by the UI. |
| `db/` | Liquibase initialization and schema migrations. |
| `docker/` | Env templates, Dockerfiles, nginx templates, and deployment scripts. |
| `desktop/` | Wails desktop client; see its [guide](desktop/README.md). |

- [Docker operations](docker/README.md#production-server) — the env-driven workflow also used locally.
- [API documentation](docs/api/README.md) and [document search API](docs/api/document-search.md).
- [Search synchronization internals](server/searchsync/README.md).
- [Backup and restore operations](backup/README.md).
- [Editor package development](packages/editor/README.md).
