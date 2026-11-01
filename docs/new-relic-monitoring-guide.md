# New Relic setup: commands, files, and checks

This is a setup guide, not an installed monitoring system. Run the commands on the **Linux Docker host**, in staging first. Examples use the production Compose templates in this repository.

**Application monitoring choice:** use OpenTelemetry in Go and OTLP to a Collector. New Relic is the current export destination; the application code stays independent of it. Existing infrastructure integrations and Fluent Bit remain New Relic-specific deployment components. Step 9 uses New Relic Browser and is also provider-specific.

**Already added:** your infrastructure agent container. **Still needed:** service collectors, logs, Go tracing, browser monitoring, and alerts.

## Follow this order

| Step | Result |
| --- | --- |
| 1–2 | Host and container metrics |
| 3–5 | PostgreSQL, Redis, and NGINX metrics |
| 6 | Searchable container logs |
| 7–8 | Vendor-neutral API and collaboration traces through OpenTelemetry |
| 9 | Browser errors and browser-to-API traces |
| 10 | Dashboard and working alerts |

Each step below tells you what to edit, what to run, and what success looks like.

## 1. Check your existing files and deployment

Your server folders are:

```text
/root/newrelic-infra/
├── docker-compose.yaml
├── integrations.d/
└── newrelic-infra.yml

/root/beskar/                 # application repository
```

Use the existing `docker-compose.yaml`. Do not create a second monitoring Compose file or move the existing license configuration.

All commands below run on your Linux server as root. They use full paths and the standard `docker compose` command; no `dmon` or `dc` helper is needed.

### 1.1 Check the Compose files

```bash
ls -l /root/newrelic-infra/docker-compose.yaml /root/newrelic-infra/newrelic-infra.yml
ls -ld /root/newrelic-infra/integrations.d
ls -l /root/beskar/docker/.generated/compose.yml
docker compose ls
```

The application commands below assume you deploy with `/root/beskar/docker/.generated/compose.yml`, produced by this repository's deployment scripts. Confirm this matches the application's **CONFIG FILES** entry in `docker compose ls`. If your running application uses another file, use that path instead in the commands below. The repository's root `docker-compose.yml` is a different local stack.

### 1.2 Read the existing Compose project names

Run in Bash:

```bash
MONITOR_PROJECT=$(docker inspect newrelic-infra --format '{{index .Config.Labels "com.docker.compose.project"}}')
APP_PROJECT=$(docker ps --filter network=beskar-network --filter label=com.docker.compose.service=server --format '{{.Label "com.docker.compose.project"}}' | sort -u)
DEPLOY_ENV=/root/beskar/docker/env/prod.env

printf 'Monitoring project: %s\nApplication project: %s\n' "$MONITOR_PROJECT" "$APP_PROJECT"
test -n "$MONITOR_PROJECT" && test -n "$APP_PROJECT"
```

**Expected:** one non-empty project name on each line. Reusing these names updates the existing deployment.

If the application name is empty or contains multiple names, read `docker compose ls` and set `APP_PROJECT` to the single existing application project name before continuing.

`DEPLOY_ENV` is the application's existing deployment settings file. If you deploy using a different env file, set its actual path here. Do not create a replacement env file with example credentials.

Keep this terminal open. In a new terminal, repeat the variable commands in 1.2 before using later commands containing `$APP_PROJECT`, `$MONITOR_PROJECT`, or `$DEPLOY_ENV`.

### 1.3 Check containers and the network

```bash
docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" ps
docker compose -f /root/beskar/docker/.generated/compose.yml -p "$APP_PROJECT" ps
docker network inspect beskar-network --format '{{range .Containers}}{{println .Name}}{{end}}'
docker info --format 'cgroup={{.CgroupVersion}} log-driver={{.LoggingDriver}}'
```

**Expected:** your existing agent and application containers are listed. If the network has another name, replace `beskar-network` throughout this guide.

## 2. Update the agent so it can run service integrations

### 2.1 Choose the network setup

For this walkthrough, **keep the agent on `beskar-network`**. It can then reach `postgres:5432`, `redis:6379`, and `proxy:8088` directly.

| Setting | Use here? | Reason |
| --- | --- | --- |
| `cgroup: host` | Yes on cgroup v2 | Lets the agent see host cgroups |
| `network_mode: host` | No | This walkthrough uses Compose DNS for service collection |
| `networks: [beskar-network]` | Yes | Keeps service names reachable |

This setup collects host/container resource metrics, but host network-interface metrics can be incomplete. For full host network visibility, see the separate option at the end. Do not add `network_mode: host` to the examples below without changing the integration endpoints.

### 2.2 Keep your existing agent configuration

In New Relic, open **API keys** and copy the **ingest license key** for your account. Note whether the account uses the US, EU, or Japan region.

Edit `/root/newrelic-infra/newrelic-infra.yml`. Keep its existing valid `license_key` and other settings. Add or merge the host name and attributes if needed; do not add duplicate YAML keys:

```yaml
license_key: YOUR_EXISTING_INGEST_LICENSE_KEY
display_name: beskar-staging-host
custom_attributes:
  environment: staging
```

The key shown above is a placeholder for the key already in your file. Change the host name and environment for production.

```bash
chmod 600 "/root/newrelic-infra/newrelic-infra.yml"
```

These credential files live outside the repository. Do not copy them into a Docker image.

### 2.3 Update your existing monitoring Compose file

Edit `/root/newrelic-infra/docker-compose.yaml`. Use this agent configuration, keeping any other services you have already added:

```yaml
services:
  agent:
    image: newrelic/infrastructure-bundle:latest
    container_name: newrelic-infra
    cap_add:
      - SYS_PTRACE
    pid: host
    cgroup: host
    privileged: true
    volumes:
      - /:/host:ro
      - /var/run/docker.sock:/var/run/docker.sock
      - ./newrelic-infra.yml:/etc/newrelic-infra.yml:ro
      - ./integrations.d:/etc/newrelic-infra/integrations.d:ro
    restart: unless-stopped
    networks:
      - beskar-network

networks:
  beskar-network:
    external: true
    name: beskar-network
```

Use the **bundle** image because it includes PostgreSQL, Redis, and NGINX integrations. The basic infrastructure image does not include all of them. Use `image:` as shown and remove the old agent `build:` section if it is still present. With this setup you do not need a `newrelic-infra.dockerfile`.

If Step 1 reports cgroup version `1`, you can omit `cgroup: host`. Current Docker Compose is needed for that setting.

Run:

```bash
docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" config --quiet
docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" pull agent
docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" up -d --force-recreate agent
docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" logs --tail 100 agent
```

These commands use your existing folder, file, and project. Recreating `agent` applies image, mount, and cgroup changes; a plain restart does not. Keep one infrastructure agent on this host.

For production, replace `latest` with the tested image digest. Find the downloaded digest with:

```bash
docker image inspect newrelic/infrastructure-bundle:latest --format '{{index .RepoDigests 0}}'
```

Paste the returned `newrelic/infrastructure-bundle@sha256:...` value into `image:`.

### 2.4 Check data in New Relic

1. Open your New Relic account in the browser.
2. At the **bottom of the page**, click the **Query your data** bar to expand the query console.
3. Select **NRQL** mode if needed, and choose the account receiving your agent's data.
4. Paste the query below and click **Run**.

This is the bottom drawer, not a left-sidebar menu item. See [New Relic's query builder instructions](https://docs.newrelic.com/docs/query-your-data/explore-query-data/query-builder/introduction-query-builder/).

Run:

```sql
FROM ContainerSample SELECT count(*) FACET containerName SINCE 15 minutes ago
```

Then:

```sql
FROM SystemSample SELECT latest(cpuPercent), latest(memoryUsedPercent)
FACET hostname SINCE 15 minutes ago
```

**Expected:** recent rows for your containers and host. Allow a few minutes for the first data.

**If empty:** check `docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" logs --tail 100 agent` for license, connection, or Docker socket errors. Verify the ingest key belongs to the account you are viewing.

Sources: [Container agent requirements](https://docs.newrelic.com/docs/infrastructure/infrastructure-agent/linux-installation/infra-agent-as-container/), [bundle image contents](https://docs.newrelic.com/docs/infrastructure/host-integrations/host-integrations-list/flex-integration-tool-build-your-own-integration/).

## 3. Configure PostgreSQL collection

### 3.1 Give your existing monitoring user access

Your PostgreSQL monitoring user is `newrelic`, with a password you already set. Use that account; no new user or password reset is needed.

Open an administrator SQL session inside the existing database container:

```bash
docker compose -f /root/beskar/docker/.generated/compose.yml -p "$APP_PROJECT" exec postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres'
```

Run in `psql`:

```sql
GRANT pg_monitor TO newrelic;
GRANT CONNECT ON DATABASE postgres TO newrelic;
GRANT CONNECT ON DATABASE beskar TO newrelic;
GRANT CONNECT ON DATABASE auth TO newrelic;
GRANT CONNECT ON DATABASE search TO newrelic;
GRANT CONNECT ON DATABASE zitadel TO newrelic;
\q
```

These grants can be run again if already applied. Replace database names if your deployment env uses different names. Keep the existing password for the collector configuration below.

### 3.2 Add the collector file

Create `/root/newrelic-infra/integrations.d/postgresql.yml`:

```yaml
integrations:
  - name: nri-postgresql
    env:
      HOSTNAME: postgres
      PORT: "5432"
      USERNAME: newrelic
      PASSWORD: 'REPLACE_WITH_EXISTING_NEWRELIC_DB_PASSWORD'
      DATABASE: postgres
      COLLECTION_LIST: '{"beskar":{},"auth":{},"search":{},"zitadel":{}}'
      COLLECT_DB_LOCK_METRICS: "false"
      COLLECT_BLOAT_METRICS: "false"
      ENABLE_QUERY_MONITORING: "false"
    interval: 30s
    labels:
      environment: staging
```

Enter the password you already set for PostgreSQL user `newrelic` in `PASSWORD`. This is the database password, separate from the New Relic ingest license key. If the password contains a single quote, double that quote inside the YAML single-quoted value. Update database names if needed.

An empty object collects database-level metrics without discovering every table/index. Leave advanced query and lock collection off for this first check.

```bash
chmod 600 "/root/newrelic-infra/integrations.d/postgresql.yml"
docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" restart agent
docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" logs --since 5m agent
```

In New Relic:

```sql
FROM PostgresqlInstanceSample, PostgresqlDatabaseSample
SELECT count(*) FACET eventType() SINCE 30 minutes ago
```

**Expected:** nonzero PostgreSQL sample counts. This first check does not depend on database-name attributes.

Then run:

```sql
FROM PostgresqlDatabaseSample SELECT latest(db.connections)
FACET database SINCE 15 minutes ago
```

**Expected:** connection counts for the configured databases.

If the first query has rows but the second does not, inspect a raw sample before changing collection settings:

```sql
FROM PostgresqlDatabaseSample SELECT * SINCE 30 minutes ago LIMIT 5
```

If neither sample type has data, confirm the selected account receives your host/container data, check database connectivity, and read agent logs after startup. An integration health-check message alone does not verify ingestion. An obsolete Compose `version` warning is separate from PostgreSQL collection.

**If empty:** check for login errors, wrong database names, or `nri-postgresql` errors in agent logs. Inspect available attributes with:

```sql
FROM PostgresqlDatabaseSample SELECT keyset() SINCE 15 minutes ago
```

### 3.3 Enable slow-query logs

Both production Compose templates (`/root/beskar/docker/templates/compose.http.yml.tmpl` and `/root/beskar/docker/templates/compose.https.yml.tmpl`) now include these entries in `postgres.command`. Update the checkout on your server before rendering; do not add duplicate entries:

```yaml
      - -c
      - log_statement=none
      - -c
      - log_min_duration_statement=1000
      - -c
      - log_lock_waits=on
```

`log_min_duration_statement=1000` logs both SQL text and duration for completed statements taking at least 1 second, even with `log_statement=none`. Keep `log_statement=none` for slow-query logging; setting it to `all` would also log fast queries. These logs can include SQL text; review what queries contain before enabling them in production.

Render, validate, and apply in staging. Recreating PostgreSQL briefly interrupts database connections:

```bash
bash /root/beskar/docker/scripts/validate-config.sh --env "$DEPLOY_ENV"
docker compose -f /root/beskar/docker/.generated/compose.yml -p "$APP_PROJECT" up -d --no-deps postgres
```

Test:

```bash
docker compose -f /root/beskar/docker/.generated/compose.yml -p "$APP_PROJECT" exec postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "SELECT pg_sleep(1.2);"'
docker compose -f /root/beskar/docker/.generated/compose.yml -p "$APP_PROJECT" logs --since 2m postgres
```

**Expected:** a duration log for the test query. Step 6 sends it to New Relic.

For table/index metrics later, grant schema usage and table SELECT permissions only in the databases/schemas you intend to monitor, then expand `COLLECTION_LIST`. For query statistics, configure `pg_stat_statements` and the integration's query-monitoring options separately. The templates already preload that library; the extension still needs to exist in the collection database.

Source: [PostgreSQL configuration and permissions](https://docs.newrelic.com/install/postgresql/).

## 4. Configure Redis collection using an env file

### 4.1 Use Beskar's existing env file

Use the application env file containing `REDIS_PASSWORD`, identified by `DEPLOY_ENV` in Step 1.2. The example path below is `/root/beskar/docker/env/prod.env`; replace it if your existing file has a different name.

Keep the current `REDIS_PASSWORD` value. No new env file or password copy is needed.

### 4.2 Load that file into the agent

In `/root/newrelic-infra/docker-compose.yaml`, add this under the existing `agent` service, alongside `image` and `volumes`:

```yaml
    env_file:
      - /root/beskar/docker/env/prod.env
```

Append to an existing `env_file` list if present. Do not add a second `agent` service. Compose loads this file into the agent container; the integration cannot read a Compose env file by itself.

### 4.3 Allow New Relic to pass the variable to integrations

In `/root/newrelic-infra/newrelic-infra.yml`, add this top-level setting, alongside `license_key`:

```yaml
passthrough_environment:
  - REDIS_PASSWORD
```

If `passthrough_environment` already exists, append `REDIS_PASSWORD` to its list.

### 4.4 Reference the variable in the Redis integration

Create or edit `/root/newrelic-infra/integrations.d/redis.yml`:

```yaml
integrations:
  - name: nri-redis
    env:
      HOSTNAME: redis
      PORT: "6379"
      PASSWORD: "{{REDIS_PASSWORD}}"
      METRICS: "true"
      REMOTE_MONITORING: "true"
    interval: 30s
    labels:
      environment: staging
```

Use the double curly braces exactly as shown. New Relic expands them; this is not Compose `${...}` substitution. Only allow `REDIS_PASSWORD` through to integrations; do not use a blanket `.*` passthrough. Keep PostgreSQL credentials configured separately.

If Redis uses a named ACL account, add `USERNAME` and use that account's password. The current application template uses `requirepass`.

### 4.5 Recreate the agent and check collection

Use the `MONITOR_PROJECT` value from Step 1.2:

```bash
docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" config --quiet
docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" up -d --force-recreate agent
docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" logs --since 5m agent
```

Recreate the container after adding/changing `env_file` or its password. A plain restart does not reload container environment variables.

In New Relic:

```sql
FROM RedisSample SELECT * LIMIT 5 SINCE 15 minutes ago
```

**Expected:** Redis samples with memory, client, and command metrics.

**If empty:** look for authentication errors or failure to resolve `redis`. Confirm the Redis container and agent are both on `beskar-network`.

Compose loads the existing env file into the agent container. The `passthrough_environment` list controls which variables the agent passes to its integrations.

Sources: [Redis collector configuration](https://github.com/newrelic/nri-redis/blob/master/redis-config.yml.sample), [New Relic environment passthrough](https://docs.newrelic.com/docs/infrastructure/host-integrations/troubleshooting/pass-infrastructure-agent-parameters-host-integration/).

## 5. Configure NGINX collection and access logs

### 5.1 Update the server checkout

The repository now includes the NGINX changes in both files. Update `/root/beskar` on the server to the version containing these changes:

- `/root/beskar/docker/templates/nginx.http.conf.tmpl`
- `/root/beskar/docker/templates/nginx.https.conf.tmpl`

Both templates include this separate internal status server. Do not add it a second time:

```nginx
server {
    listen 8088;
    server_name _;
    access_log off;
    location = /nginx_status {
        stub_status;
    }
    location / {
        return 404;
    }
}
```

Do **not** publish port `8088` in Compose. It is only for containers on the application network.

### 5.2 Enable useful access logs

Both templates now write JSON access logs to stdout using this format. By default they keep only 4xx/5xx responses and requests taking at least one second:

```nginx
log_format monitoring escape=json
    '{"service":"proxy","method":"$request_method",'
    '"status":$status,"request_time":$request_time,'
    '"upstream_status":"$upstream_status",'
    '"upstream_response_time":"$upstream_response_time",'
    '"request_id":"$request_id"}';
access_log /dev/stdout monitoring if=$monitoring_loggable;
```

In `/root/beskar/docker/env/prod.env` (or your existing deployment env file), use:

```dotenv
ZITADEL_LOG_LEVEL=warn
ZITADEL_ACCESS_LOG_STDOUT_ENABLED=false
PROXY_ACCESS_LOG_MODE=errors_slow
PROXY_ERROR_LOG_LEVEL=warn
```

`errors_slow` keeps proxy 4xx/5xx responses and requests lasting at least 1 second. Set `all` to restore every access log or `off` to disable access logs. Proxy error logs remain separately controlled by `PROXY_ERROR_LOG_LEVEL`.

Zitadel's runtime logs use `ZITADEL_LOG_LEVEL`; its separate access-log stream stays disabled. Changing these env settings requires rendering and recreating Zitadel. Do not expect an env-file edit alone to update a running container.

Error logs go to `/dev/stderr`. This first format omits paths, query strings, cookies, and tokens. Add a sanitized route field later if needed.

Apply and test:

```bash
bash /root/beskar/docker/scripts/validate-config.sh --env "$DEPLOY_ENV"
docker compose -f /root/beskar/docker/.generated/compose.yml -p "$APP_PROJECT" up -d --no-deps zitadel
docker compose -f /root/beskar/docker/.generated/compose.yml -p "$APP_PROJECT" exec proxy nginx -t
docker compose -f /root/beskar/docker/.generated/compose.yml -p "$APP_PROJECT" exec proxy nginx -s reload
docker compose -f /root/beskar/docker/.generated/compose.yml -p "$APP_PROJECT" exec proxy wget -qO- http://127.0.0.1:8088/nginx_status
```

The generated config is already bind-mounted into `proxy`. If the running container still sees the old file after rendering, recreate only the proxy with `docker compose -f /root/beskar/docker/.generated/compose.yml -p "$APP_PROJECT" up -d --no-deps --force-recreate proxy`, then repeat the checks.

**Expected:** `nginx -t` succeeds and the status response starts with `Active connections:`.

### 5.3 Add the collector

Copy the ready-to-use integration configuration from the updated repository:

```bash
install -m 644 /root/beskar/docker/monitoring/nginx.yml /root/newrelic-infra/integrations.d/nginx.yml
```

This file contains:

```yaml
integrations:
  - name: nri-nginx
    env:
      METRICS: "true"
      STATUS_URL: http://proxy:8088/nginx_status
      STATUS_MODULE: ngx_http_stub_status_module
      REMOTE_MONITORING: "true"
    interval: 30s
    labels:
      service: proxy
```

Run:

```bash
docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" restart agent
```

In New Relic:

```sql
FROM NginxSample SELECT * LIMIT 5 SINCE 15 minutes ago
```

**Expected:** NGINX connection/request counters. `errors_slow` access logs cover only failures/slow requests, so do not use them to calculate total request volume or overall latency percentiles. The status endpoint counters still cover all requests. In the UI, open **Infrastructure → Third-party services → NGINX**.

Access logs provide response codes and timings; `stub_status` does not. Check JSON access logs after a request that returns 4xx/5xx or takes at least one second. Fast successful requests are intentionally absent:

```bash
docker compose -f /root/beskar/docker/.generated/compose.yml -p "$APP_PROJECT" logs --since 2m proxy
```

Sending these access logs to New Relic requires the Fluent Bit setup in Step 6. The `nri-nginx` integration only sends metrics.

If there are no `NginxSample` events, test reachability from the agent:

```bash
docker exec newrelic-infra wget -qO- http://proxy:8088/nginx_status
```

If the image has no `wget`, use a temporary diagnostic container on `beskar-network`. A DNS/connectivity error means the agent cannot reach the private status endpoint; check network membership. If the status page works, check agent logs for `nri-nginx` collection errors.

Source: [NGINX collector configuration](https://github.com/newrelic/nri-nginx/blob/master/nginx-config.yml.sample).

## 6. Send container logs with automatic discovery

Fluent Bit watches `/var/lib/docker/containers/*/*-json.log` and scans for new files every 5 seconds. Recreated containers get discovered automatically; no generated `inputs.conf` is needed.

Docker adds Compose project/service labels to each log record. Fluent Bit uses them to select only your project's seven services and keep a stable `service` field across container recreation. It does not need the Docker socket.

### 6.1 Apply the Docker logging labels once

The repository's `docker/scripts/common.sh` now adds this option to every application's `json-file` logging block:

```yaml
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
        labels: "com.docker.compose.project,com.docker.compose.service"
```

The actual size/file limits still come from your existing deployment env settings.

Update `/root/beskar` to the version containing this change, then render and validate:

```bash
bash /root/beskar/docker/scripts/validate-config.sh --env "$DEPLOY_ENV"
```

**One-time rollout:** recreate the affected containers during your planned deployment window so Docker applies the new logging options:

```bash
docker compose -f /root/beskar/docker/.generated/compose.yml -p "$APP_PROJECT" up -d --no-deps server signalserver postgres redis proxy guard zitadel
```

The changed logging options cause Compose to recreate these services. This includes PostgreSQL and Redis, so plan for interruption. A plain restart does not apply Docker logging options. You can instead apply the change service by service during normal deployments; that service's logs become eligible after its recreation.

Check one updated container:

```bash
container_id=$(docker compose -f /root/beskar/docker/.generated/compose.yml -p "$APP_PROJECT" ps -q proxy)
docker inspect "$container_id" --format '{{json .HostConfig.LogConfig}}'
```

**Expected:** driver `json-file` and the `labels` option containing both Compose labels. This setup requires rootful Docker with logs under `/var/lib/docker/containers/`.

### 6.2 Copy the ready-to-use Fluent Bit files

```bash
install -m 644 /root/beskar/docker/monitoring/parsers.conf /root/newrelic-infra/parsers.conf
install -m 644 /root/beskar/docker/monitoring/fluent-bit.conf /root/newrelic-infra/fluent-bit.conf
```

In Beskar's existing env file (`/root/beskar/docker/env/prod.env`, or your actual deployment env filename), add or update:

```dotenv
NEW_RELIC_LICENSE_KEY='REPLACE_WITH_INGEST_LICENSE_KEY'
NEW_RELIC_LOG_ENDPOINT=https://log-api.newrelic.com/log/v1
BESKAR_LOG_PROJECT=beskar-prod
BESKAR_LOG_ENVIRONMENT=production
```

Reuse an existing `NEW_RELIC_LICENSE_KEY` entry. Set `BESKAR_LOG_PROJECT` to the existing `APP_PROJECT` value from Step 1.2. Use `staging` for the environment when testing in staging.

For EU, use `https://log-api.eu.newrelic.com/log/v1`; for Japan, use `https://log-api.jp.nr-data.net/log/v1`.

The main input in `fluent-bit.conf` is:

```ini
[INPUT]
    Name tail
    Path /var/lib/docker/containers/*/*-json.log
    Tag beskar.containers
    Parser docker_json
    Path_Key docker.log_path
    DB /state/containers.db
    DB.Compare_Filename On
    Read_from_Head On
    Mem_Buf_Limit 50MB
    Skip_Long_Lines On
    Refresh_Interval 5
    Rotate_Wait 30
```

The rest of the supplied file filters Docker's labels, parses JSON application logs, sets `service`/`compose.project`/`environment`, and sends logs to New Relic. Unrelated projects, unlabelled logs, and the monitoring containers' own logs are excluded.

**First-run behavior:** files without a saved offset are read from the beginning, so retained eligible logs can be forwarded once. When migrating from the old per-service inputs, the new `containers.db` does not reuse their offsets; logs already carrying the labels can be replayed. Existing unlabelled log records are skipped. Keep the state volume to retain offsets across forwarder restarts.

Do not include or mount the old generated `inputs.conf` alongside this configuration: that could read the same files twice.

### 6.3 Start or update the forwarder

Use this service under `services:` in `/root/newrelic-infra/docker-compose.yaml`. Replace the old `logs` service definition if already present:

```yaml
  logs:
    image: newrelic/newrelic-fluentbit-output@sha256:87b92e85b5344678d7315d0b5552b241a9f976977c7ced9f044d1e6d797a5a02
    command: ["-c", "/fluent-bit/etc/fluent-bit.conf", "-e", "/fluent-bit/bin/out_newrelic.so"]
    user: "0:0"
    env_file:
      - /root/beskar/docker/env/prod.env
    volumes:
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - ./fluent-bit.conf:/fluent-bit/etc/fluent-bit.conf:ro
      - ./parsers.conf:/fluent-bit/etc/beskar-parsers.conf:ro
      - log_state:/state
    restart: unless-stopped
```

Use your actual Beskar env filename in `env_file`. Keep this top-level volume declaration, adding it only if absent:

```yaml
volumes:
  log_state:
```

Run:

```bash
docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" config --quiet
docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" up -d --force-recreate logs
docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" logs --tail 100 logs
```

Fluent Bit expands the `${...}` variables from its own environment; infrastructure-agent `passthrough_environment` is not needed. Recreate `logs` after changing its env values or mounts. The image above is pinned to the tested digest (Fluent Bit 5.1.5). The corrected published image name is `newrelic/newrelic-fluentbit-output`; the older `newrelic/logging-fluent-bit` name in this guide was incorrect.

### 6.4 Check logs and discovery

Generate a proxy request that returns 4xx/5xx or takes at least one second (or temporarily use `PROXY_ACCESS_LOG_MODE=all`), then run in New Relic:

```sql
FROM Log SELECT count(*) FACET service
WHERE compose.project = 'beskar-prod' SINCE 15 minutes ago
```

Replace the project name if different. Quiet services may have no new logs yet. Repeat the `pg_sleep` test from Step 3 to check PostgreSQL logs too.

**During the next normal application deployment:** note the new container ID, generate a new request/log after deployment, and check that it appears with the same `service` field. New files are discovered on the five-second scan; allow additional time for flushing and New Relic ingestion. You do not regenerate inputs or restart Fluent Bit for an application recreation.

If logs are missing, check the container's logging labels, `BESKAR_LOG_PROJECT`, key/region, and forwarder logs. A running container from before the logging-option rollout still lacks the required log attributes.

The watcher follows active log files and waits briefly for rotated files. A container created and deleted between scans, logs deleted before discovery, oversized lines, or a long forwarding outage can still cause loss. This setup does not collect host journal/Docker daemon logs. Keep only one forwarding pipeline for these container logs.

Sources: [Docker JSON-file logging options](https://docs.docker.com/engine/logging/drivers/json-file/), [Fluent Bit wildcard discovery and offsets](https://docs.fluentbit.io/manual/data-pipeline/inputs/tail), [New Relic log output](https://docs.newrelic.com/docs/logs/forward-logs/fluent-bit-plugin-log-forwarding/).

## 7. Enable vendor-neutral Go monitoring with OpenTelemetry

The API and signal server now include OpenTelemetry instrumentation. You do not need to edit Go code or run `go get` on the server.

```text
Go services → OTLP/HTTP → OpenTelemetry Collector → New Relic
```

Telemetry export is **disabled by default** until the Collector is ready. New Relic credentials live in the Collector, not the Go telemetry code. To change providers later, change the Collector exporter. Dashboards/alerts still need migration.

### 7.1 Update the checkout and existing env file

Update `/root/beskar` to the version containing the implementation.

In `/root/beskar/docker/env/prod.env`, add or update these existing backend settings:

```dotenv
NEW_RELIC_LICENSE_KEY='REPLACE_WITH_INGEST_LICENSE_KEY'
NEW_RELIC_OTLP_ENDPOINT=https://otlp.nr-data.net
```

Reuse your existing license key entry. For EU use `https://otlp.eu01.nr-data.net`; for Japan use `https://otlp.jp.nr-data.net`.

The ready-to-use Collector files are:

- `/root/beskar/docker/monitoring/otel-collector.yml`: OTLP receiver, batching, memory limit, and backend exporter.
- `/root/beskar/docker/monitoring/compose.otel.yml`: Collector service attached to `beskar-network`, without publishing port 4318.

The overlay loads `/root/beskar/docker/env/prod.env`. Adjust that file's `env_file` path if your deployment uses another filename.

### 7.2 Start the Collector

Use the monitoring project name from Step 1.2. Include **both** Compose files for Collector commands:

```bash
docker compose -f /root/newrelic-infra/docker-compose.yaml \
  -f /root/beskar/docker/monitoring/compose.otel.yml \
  -p "$MONITOR_PROJECT" config --quiet

docker compose -f /root/newrelic-infra/docker-compose.yaml \
  -f /root/beskar/docker/monitoring/compose.otel.yml \
  -p "$MONITOR_PROJECT" run --rm --no-deps otel-collector \
  validate --config=/etc/otelcol-contrib/config.yaml

docker compose -f /root/newrelic-infra/docker-compose.yaml \
  -f /root/beskar/docker/monitoring/compose.otel.yml \
  -p "$MONITOR_PROJECT" up -d otel-collector
```

**Expected:** validation succeeds and `otel-collector` stays running. It receives OTLP/HTTP privately at `http://otel-collector:4318`.

The configuration batches and retries exports, but has no durable disk queue. Long outages can lose buffered telemetry.

### 7.3 Enable export in Beskar's env file

Add these to `/root/beskar/docker/env/prod.env`:

```dotenv
OTEL_SDK_DISABLED=false
OTEL_SERVER_SERVICE_NAME=beskar-api-prod
OTEL_SIGNAL_SERVICE_NAME=beskar-signal-prod
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=production
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
```

`0.1` samples 10% of new traces and follows an incoming parent's sampling decision. For initial staging checks, use `1` and staging service/environment names. Metrics are not trace-sampled.

Both production Compose templates map the service-specific names into standard `OTEL_SERVICE_NAME` variables. The Go services use standard OpenTelemetry configuration and HTTP/protobuf exporters. No vendor-specific Go agent is installed.

### 7.4 Build and apply the application changes

```bash
bash /root/beskar/docker/scripts/validate-config.sh \
  --env /root/beskar/docker/env/prod.env

docker compose -f /root/beskar/docker/.generated/compose.yml \
  -p "$APP_PROJECT" up -d --build --no-deps server signalserver
```

This recreates the API and signal server. Plan for API interruption and collaboration reconnects. Fluent Bit automatically discovers their new log files after Step 6's logging-label rollout.

### 7.5 Check one API trace

1. Sign in and open a document to generate real API calls.
2. Open New Relic's query drawer at the bottom and run:

   ```sql
   FROM Span SELECT count(*) FACET name
   WHERE service.name = 'beskar-api-prod' SINCE 15 minutes ago
   ```

3. Open the service in New Relic's OpenTelemetry/APM views and inspect a sampled trace.
4. Check HTTP route names use patterns, and that database/cache spans appear for calls made with the request context.

**Implemented collection:**

| Area | Included |
| --- | --- |
| Incoming API HTTP | W3C propagation, bounded Chi route names, status/duration metrics; health checks excluded |
| PostgreSQL | Application and search pool tracers plus pool metrics |
| Redis | Session/page-event clients, spans, and client metrics |
| Outgoing HTTP/gRPC | Instrumented application HTTP transports and Permify's gRPC client |
| Go runtime | Runtime metrics from the OpenTelemetry runtime instrumentation |
| Shutdown | Flushes telemetry with a fresh timeout context |

HTTP query strings are omitted from span attributes while the original request still reaches the application/upstream. PostgreSQL SQL text/parameters and Redis command arguments are disabled in spans. PostgreSQL's slow-query server logs from Step 3 remain separate and can contain SQL text.

Older functions that create `context.Background()` instead of carrying the request context can produce independent spans. Background workers are not automatically connected to HTTP traces. Propagate context deliberately when updating those workflows.

If no spans appear, inspect the Collector:

```bash
docker compose -f /root/newrelic-infra/docker-compose.yaml \
  -f /root/beskar/docker/monitoring/compose.otel.yml \
  -p "$MONITOR_PROJECT" logs --tail 100 otel-collector
```

Check `OTEL_SDK_DISABLED=false` reached the recreated services, the endpoint is reachable on `beskar-network`, the region/key are correct, and sampling/traffic are sufficient. An unavailable Collector does not block application requests.

### 7.6 Find matching request logs

API failures and slow non-streaming requests have structured summaries with `trace.id`/`span.id`. The logger level still applies: `SERVER_LOG_LEVEL=error` keeps failures; set `warn` to include slow-request warnings.

For full request summaries **in staging**, use:

```dotenv
SERVER_LOG_TO_FILES=false
SERVER_LOG_LEVEL=info
SERVER_HTTP_REQUEST_LOGGING_ENABLED=true
```

Render and recreate the API to apply env changes. Open a document, then search its trace ID in Logs. Avoid leaving full request summaries enabled if ingestion volume is too high.

Handlers can call `core.RequestLogger(req.Context())` for additional trace-linked records. Existing global logger calls do not automatically receive request context. The separate auth/slog logger still needs context-aware calls where deeper auth-log correlation is desired.

Keep Fluent Bit as the log pipeline; do not also export those same records through an OTel log bridge.

### 7.7 Disable export without removing instrumentation

Set `OTEL_SDK_DISABLED=true`, render, and recreate the two Go services. The instrumentation remains in the code, but no OTLP exporters are started. Running locally without any configured OTLP endpoint also leaves export inactive.

Sources: [OpenTelemetry Go exporters](https://opentelemetry.io/docs/languages/go/exporters/), [New Relic OTLP endpoints](https://docs.newrelic.com/docs/opentelemetry/best-practices/opentelemetry-otlp/).

## 8. Verify signal-server monitoring

The signal server is enabled by the same settings and deployment commands in Step 7. It does not require manual source-code changes.

1. Open the same document in two clients and edit it.
2. Confirm updates reach both clients and reconnects still work.
3. Run:

   ```sql
   FROM Span SELECT count(*) FACET name
   WHERE service.name = 'beskar-signal-prod' SINCE 15 minutes ago
   ```

**Expected:** short `GET /ws` handshake spans, `WebSocket/Message` spans, and watchdog/Redis-update spans when those operations run. A connection lasting hours does not keep its handshake span open.

The service also emits connection counts, message counts, and message-processing duration metrics with bounded message-type attributes. Selected message/Redis errors carry trace IDs in local JSON logs. HTTP authentication calls propagate trace context to the API.

WebSocket message spans and asynchronous Redis updates are currently independent traces. Cross-message/service causality needs explicit compatible message metadata or context/span links. Do not change opaque collaboration frames to add trace headers.

## 9. Add the browser agent

### 9.1 Install the generated browser snippet

In New Relic:

1. Open **Add data** and find **Browser monitoring**.
2. Choose the browser copy/paste installation.
3. Name the application `beskar-web-staging` and select SPA monitoring where offered.
4. Copy the complete generated script.
5. Paste it near the start of `<head>` in `/root/beskar/ui/index.html`, before application scripts.

Use only the generated public Browser configuration. Do not paste the backend ingest key into the UI. This copy/paste route does not require adding Vite variables.

### 9.2 Connect browser requests to API traces

In the Browser application's settings, enable distributed tracing. If the API has a different origin, add that API origin to the allowed origins.

The API implementation already allows these tracing headers in CORS; no extra source edit is needed:

```go
"traceparent", "tracestate", "newrelic"
```

The Go services use the W3C TraceContext propagator from Step 7. Browser-to-API linking depends on the Browser agent emitting `traceparent` for that origin. Keep the existing entries. NGINX normally forwards these request headers; remove any configuration that clears them. Ordinary Browser HTTP tracing does not trace WebSocket message contents.

Rebuild:

```bash
bash /root/beskar/docker/scripts/validate-config.sh --env "$DEPLOY_ENV"
docker compose -f /root/beskar/docker/.generated/compose.yml -p "$APP_PROJECT" up -d --build --no-deps ui server
```

Fluent Bit automatically discovers recreated containers; no input regeneration is needed.

### 9.3 Verify in the browser

1. Open the staging site and reload it with browser developer tools open.
2. Check Network for successful requests to New Relic's collector. If blocked by CSP, allow the domains required by your generated snippet/region.
3. Sign in and open a document to generate API calls.
4. In New Relic, open `beskar-web-staging` and inspect an AJAX request with distributed tracing data.
5. Follow its trace into `beskar-api-prod`.

**Expected:** page/API timing data and sampled browser-to-API traces. Browser extensions, sampling, or an idle session can prevent an individual request from appearing.

For a staging error test, run this in the page's browser console:

```js
setTimeout(() => { throw new Error('beskar-newrelic-staging-test'); }, 0);
```

Search the Browser errors view for that message. Source maps are a separate release step: generate hidden maps in Vite, upload each generated map with its exact deployed JavaScript URL using the [source-map upload API](https://docs.newrelic.com/docs/browser/new-relic-browser/browser-pro-features/upload-source-maps-api/), and keep the upload administration key in CI. Until that is configured, errors can show minified source.

Source: [Browser distributed tracing](https://docs.newrelic.com/docs/browser/new-relic-browser/browser-pro-features/browser-data-distributed-tracing/).

## 10. Create a dashboard and an alert

### 10.1 Save your first dashboard

In New Relic, create a dashboard named **Beskar staging**. Run each query below and use the query builder's **Add to dashboard** action:

```sql
FROM SystemSample SELECT average(cpuPercent), average(memoryUsedPercent)
FACET hostname TIMESERIES SINCE 30 minutes ago
```

```sql
FROM Span SELECT count(*)
WHERE service.name = 'beskar-api-prod' FACET name TIMESERIES SINCE 30 minutes ago
```

```sql
FROM Log SELECT count(*) FACET service TIMESERIES SINCE 30 minutes ago
```

Use the built-in PostgreSQL, Redis, and NGINX entity views for their metrics first. A dashboard does not send notifications.

### 10.2 Create an API error alert from OpenTelemetry data

1. Open **Alerts** and create a policy named **Beskar staging**.
2. Add a **NRQL** condition with:

   ```sql
   FROM Span SELECT percentage(count(*), WHERE http.response.status_code >= 500)
   WHERE service.name = 'beskar-api-prod' AND span.kind = 'server'
   ```

3. Inspect a server span first with `FROM Span SELECT * WHERE service.name = 'beskar-api-prod' SINCE 15 minutes ago LIMIT 5`. Confirm `span.kind` and the HTTP status attribute match the query; older semantic conventions can use `http.status_code`. Span-based percentages describe sampled requests. Prefer HTTP request metrics for production error-rate alerts once their metric names are confirmed.
4. Start with a critical threshold **above 5 for 5 minutes**. This means more than 5% errors; tune it to your traffic.
5. Use a one-minute aggregation window. Set missing-data behavior separately; a quiet API is not automatically down.
6. Create/select a notification destination and workflow for this policy. Use your team's chosen channel.
7. Use the destination's test action and confirm delivery.

In staging only, temporarily return HTTP 500 from a private test handler and call it repeatedly for the evaluation window. Then restore the handler and repeat healthy calls.

**Expected:** the incident opens, a notification arrives, and the incident closes after recovery. Use an external uptime check for availability, because a stopped API sends no transaction errors.

Add disk, Redis availability, database pressure, and missing-host-data conditions after this first alert works. Apply minimum-traffic rules before using percentage alerts in production.

## Before calling the setup complete

| Test | Required result |
| --- | --- |
| Container metrics query | Recent rows for the running services |
| PostgreSQL/Redis/NGINX queries | Recent service samples |
| `pg_sleep` test | Slow-query log searchable in New Relic |
| Open a document | API transaction with dependency spans for calls made |
| Request-scoped API log | Same trace ID searchable in Logs |
| Two-client edit | Collaboration works and message traces appear |
| Browser test error | Error visible in the Browser application |
| Staging alert test | Incident, notification, and recovery work |

`guard` and `zitadel` are covered here by container metrics, logs, and traced outbound API calls where instrumented. Internal metrics/traces require their own version-specific integration; this guide does not install one.

Tracing is sampled. PostgreSQL server logs do not automatically share API trace IDs. Review sensitive fields, telemetry volume, and overhead in staging before repeating these steps in production.

## Optional: full host network metrics

Only use this if you need host network-interface metrics:

1. Replace the agent's `networks` entry with `network_mode: host`.
2. Keep the application services on `beskar-network`.
3. Replace `postgres`, `redis`, and `proxy` in integration files with host-reachable endpoints. Compose DNS will no longer work in the agent.
4. One Linux-host option is to publish **loopback-only** application ports: `127.0.0.1:15432:5432`, `127.0.0.1:16379:6379`, and `127.0.0.1:18088:8088` under their respective services in both templates.
5. Point the integrations to `127.0.0.1:15432`, `127.0.0.1:16379`, and `http://127.0.0.1:18088/nginx_status`. Check those ports are unused first.
6. Render/validate, recreate the affected services during a planned window, restart the agent, and repeat Steps 2–5 checks. Fluent Bit discovers the recreated containers automatically after Step 6's logging labels are applied.

Do not publish those ports on `0.0.0.0`. This optional change restarts the affected containers and requires rechecking database and proxy availability.

## Files edited in this walkthrough

| Location | Purpose |
| --- | --- |
| `/root/newrelic-infra/` outside Git | Infrastructure/OTel Collector/log configurations and credentials |
| Both `/root/beskar/docker/templates/compose.*.yml.tmpl` files | Slow-query settings and standard OTEL environment variables |
| `/root/beskar/docker/scripts/common.sh` | Compose labels in Docker JSON logs for automatic service discovery |
| `/root/beskar/docker/monitoring/fluent-bit.conf`, `parsers.conf` | Wildcard log collection, filtering, and parsing |
| Both `/root/beskar/docker/templates/nginx.*.conf.tmpl` files | Private status port and access logs |
| `$DEPLOY_ENV` (existing application env file) | API log output and level |
| `/root/beskar/server/`, `/root/beskar/signalserver/` | Go tracing code and dependencies |
| `/root/beskar/ui/index.html` | Generated Browser snippet |

`bash /root/beskar/docker/scripts/validate-config.sh --env "$DEPLOY_ENV"` renders templates and validates the result. Do not hand-edit `/root/beskar/docker/.generated/`; the next render overwrites it.
