# Docker Runbook

This directory contains two different Docker workflows:

- Development: legacy local stack driven by `docker/database/db.sh` and `docker/app/app.sh`
- Production-style deployment: env-driven stack driven by `docker/scripts/*.sh`

Do not mix these workflows in the same startup sequence.

## Before You Start

- Run all commands from the repository root: `/Users/kiran/projects/beskar`
- Ensure Docker and Docker Compose are installed
- Ensure the external Docker network exists when using the development flow:

```bash
docker network create custom_local_network
```

## Development Server

Use this flow for local development with the older compose files under `docker/database` and `docker/app`.

### Files Used

- Database env: `docker/database/.env`
- App env: `docker/app/.env`
- Database compose: `docker/database/db.yml`
- App compose: `docker/app/app.yml`

### Start Development Database

1. Review and update `docker/database/.env` if needed.
2. Start the database stack:

```bash
./docker/database/db.sh
```

What this does:

- Starts the database containers from `docker/database/db.yml`
- Builds the local DB init image
- Runs the `devbuild` container to initialize the databases

### Start Development App Stack

1. Review and update `docker/app/.env`.
2. Start the app stack:

```bash
./docker/app/app.sh
```

What this does:

- Starts the app services from `docker/app/app.yml`
- Builds the local app init image
- Runs the `devappbuild` container for app setup tasks

### Restart Only the Development Server Container

If you changed server code or server env only, rebuild and restart just the `server` service from the development compose file:

```bash
docker compose -f docker/app/app.yml --env-file docker/app/.env -p beskar-app build server
docker compose -f docker/app/app.yml --env-file docker/app/.env -p beskar-app up -d server
```

### Stop Development Stack

Stop the app stack:

```bash
docker compose -f docker/app/app.yml --env-file docker/app/.env -p beskar-app down
```

Stop the database stack:

```bash
docker compose -f docker/database/db.yml --env-file docker/database/.env -p beskar-db down
```

## Production Server

Use this flow for the newer env-driven deployment under `docker/env`, `docker/templates`, and `docker/scripts`.

### Files Used

- Example env file: `docker/env/deploy.env.example`
- Target env file: `docker/env/<environment>.env`
- Rendered output: `docker/.generated/`
- Deploy script: `docker/scripts/deploy.sh`

### Create the Environment File

1. Copy the example file:

```bash
cp docker/env/deploy.env.example docker/env/<environment>.env
```

2. Edit `docker/env/<environment>.env`.

You must set the values for:

- domains
- TLS certificate and key paths
- database credentials
- Redis password
- Permify secret
- Zitadel credentials
- `NPM_TOKEN`

Optional but important:

- Set `UPLOAD_STORAGE_DIR` if uploads should not be stored under the default `public` path inside the server container

### Validate the Production Config

Render the generated files:

```bash
./docker/scripts/render-configs.sh --env docker/env/<environment>.env
```

Validate the generated compose config:

```bash
./docker/scripts/validate-config.sh --env docker/env/<environment>.env
```

### Start the Production Stack

Run:

```bash
./docker/scripts/deploy.sh --env docker/env/<environment>.env
```

What this does:

- Renders `docker/.generated/compose.yml`
- Validates the generated compose file
- Starts `postgres` and `redis`
- Runs the `db-init` job
- Starts `guard`, `zitadel`, `server`, `signalserver`, `ui`, `launchsite`, and `proxy`

### Stop the Production Stack

After rendering or deploying once, stop the stack with:

```bash
docker compose -f docker/.generated/compose.yml -p <compose-project-name> down
```

Use the same project name configured in `COMPOSE_PROJECT_NAME` inside `docker/env/<environment>.env`.

## Which Flow Should You Use?

- Use `docker/database/db.sh` and `docker/app/app.sh` for local development
- Use `docker/scripts/deploy.sh --env ...` for production-style deployment
- Do not start production with `docker/app/app.yml`
- Do not start development with `docker/scripts/deploy.sh`
