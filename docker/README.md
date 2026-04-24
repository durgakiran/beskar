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

If you want a clean restart for any one development service so it picks up updated code, env, and image layers, use:

```bash
docker compose -f docker/app/app.yml --env-file docker/app/.env -p beskar-app build <service-name>
docker compose -f docker/app/app.yml --env-file docker/app/.env -p beskar-app up -d --force-recreate --no-deps <service-name>
```

Example for the development `server` service:

```bash
docker compose -f docker/app/app.yml --env-file docker/app/.env -p beskar-app build server
docker compose -f docker/app/app.yml --env-file docker/app/.env -p beskar-app up -d --force-recreate --no-deps server
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
- Set `UI_USE_LOCAL_EDITOR_DIST=true` only when you want the deployment-style UI image to test local `packages/editor/dist` output instead of the published `@durgakiran/editor` package

### Configure Email Notifications

The email notification engine is disabled by default. To enable queued email delivery for a deployment, set:

```env
EMAIL_NOTIFICATIONS_ENABLED=true
EMAIL_WORKER_ENABLED=true
EMAIL_PROVIDER=smtp
EMAIL_FROM_ADDRESS=no-reply@example.com
EMAIL_FROM_NAME=Beskar
EMAIL_APP_BASE_URL=https://app.example.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USERNAME=replace-with-smtp-username
SMTP_PASSWORD=replace-with-smtp-password
SMTP_USE_TLS=true
SMTP_TIMEOUT_SECONDS=10
```

Operational email debug routes stay disabled unless both `EMAIL_ADMIN_ENABLED=true` and `EMAIL_ADMIN_TOKEN` are set. Requests must be authenticated and include `X-Email-Admin-Token: <token>`.

### Validate the Production Config

Render the generated files:

```bash
./docker/scripts/render-configs.sh --env docker/env/<environment>.env
```

Validate the generated compose config:

```bash
./docker/scripts/validate-config.sh --env docker/env/<environment>.env
```

If `UI_USE_LOCAL_EDITOR_DIST=true`, build the editor package first so the deploy UI image can overlay the local artifacts:

```bash
npm --prefix packages/editor run build
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

### Clean Restart One Production Service

If you changed code, Dockerfile, or env for one production service, first re-render the generated compose file, then rebuild and recreate only that service:

```bash
./docker/scripts/render-configs.sh --env docker/env/<environment>.env
docker compose -f docker/.generated/compose.yml -p <compose-project-name> build <service-name>
docker compose -f docker/.generated/compose.yml -p <compose-project-name> up -d --force-recreate --no-deps <service-name>
```

Use the `COMPOSE_PROJECT_NAME` value from `docker/env/<environment>.env` as `<compose-project-name>`.

Example for the production `server` service:

```bash
./docker/scripts/render-configs.sh --env docker/env/prod.env
docker compose -f docker/.generated/compose.yml -p beskar-prod build server
docker compose -f docker/.generated/compose.yml -p beskar-prod up -d --force-recreate --no-deps server
```

Use `--build` on the `up` command instead of a separate `build` only if you prefer a one-liner:

```bash
./docker/scripts/render-configs.sh --env docker/env/prod.env
docker compose -f docker/.generated/compose.yml -p beskar-prod up -d --build --force-recreate --no-deps server
```

### Apply the Permify Schema

Beskar expects the Permify schema to exist. If the app starts but authorization checks fail because the schema is missing, apply it with this request after the stack is up.

From the deployment host:

```bash
curl -X POST http://localhost:3476/v1/tenants/t1/schemas/write \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <permify-secret>' \
  --data-raw '{
    "schema": "entity user {}\nentity tenant {\n    relation space @space\n}\nentity space {\n    relation owner @user\n    relation admin @user\n    relation editor @user\n    relation commentor @user\n    relation viewer @user\n\n    permission delete = owner\n    permission edit = owner or admin\n    permission edit_page = owner or admin or editor\n    permission view = owner or admin or editor or commentor or viewer\n    permission invite_admin = owner\n    permission invite_member = owner or admin\n    permission add_comment = owner or admin or editor or commentor\n    permission manage_members = owner or admin\n    permission transfer_owner = owner\n    permission archive = owner or admin\n}\nentity page {\n    relation owner @space#owner @space#admin @space#editor\n    relation parent @page\n    relation space @space\n\n    permission edit = space.edit or space.editor\n    permission view = space.view\n    permission delete = owner or space.owner\n    permission add_comment = space.add_comment\n}\n"
  }'
```

Replace `<permify-secret>` with the value of `PERMIFY_SECRET` from `docker/env/<environment>.env`.

If you want to avoid typing the secret inline:

```bash
source docker/env/<environment>.env
curl -X POST http://localhost:3476/v1/tenants/t1/schemas/write \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $PERMIFY_SECRET" \
  --data-raw '{
    "schema": "entity user {}\nentity tenant {\n    relation space @space\n}\nentity space {\n    relation owner @user\n    relation admin @user\n    relation editor @user\n    relation commentor @user\n    relation viewer @user\n\n    permission delete = owner\n    permission edit = owner or admin\n    permission edit_page = owner or admin or editor\n    permission view = owner or admin or editor or commentor or viewer\n    permission invite_admin = owner\n    permission invite_member = owner or admin\n    permission add_comment = owner or admin or editor or commentor\n    permission manage_members = owner or admin\n    permission transfer_owner = owner\n    permission archive = owner or admin\n}\nentity page {\n    relation owner @space#owner @space#admin @space#editor\n    relation parent @page\n    relation space @space\n\n    permission edit = space.edit or space.editor\n    permission view = space.view\n    permission delete = owner or space.owner\n    permission add_comment = space.add_comment\n}\n"
  }'
```

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
