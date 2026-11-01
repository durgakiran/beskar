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
DEPLOY_ENV=/root/beskar/docker/env/deploy.env

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

Use the application env file containing `REDIS_PASSWORD`, identified by `DEPLOY_ENV` in Step 1.2. The example path below is `/root/beskar/docker/env/deploy.env`; replace it if your existing file has a different name.

Keep the current `REDIS_PASSWORD` value. No new env file or password copy is needed.

### 4.2 Load that file into the agent

In `/root/newrelic-infra/docker-compose.yaml`, add this under the existing `agent` service, alongside `image` and `volumes`:

```yaml
    env_file:
      - /root/beskar/docker/env/deploy.env
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

Both templates now write JSON access logs to stdout using this format:

```nginx
log_format monitoring escape=json
    '{"service":"proxy","method":"$request_method",'
    '"status":$status,"request_time":$request_time,'
    '"upstream_status":"$upstream_status",'
    '"upstream_response_time":"$upstream_response_time",'
    '"request_id":"$request_id"}';
access_log /dev/stdout monitoring;
```

Error logs remain on `/dev/stderr` at `warn` level. This first format omits paths, query strings, cookies, and tokens. Add a sanitized route field later if needed.

Apply and test:

```bash
bash /root/beskar/docker/scripts/validate-config.sh --env "$DEPLOY_ENV"
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

**Expected:** NGINX connection/request counters. In the UI, open **Infrastructure → Third-party services → NGINX**.

Access logs provide response codes and timings; `stub_status` does not. Check that JSON access logs are being written after visiting the site:

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

## 6. Send container logs to New Relic

The containerized infrastructure agent does not include a log forwarder. Add one Fluent Bit container.

### 6.1 Confirm the log format and location

Run for the application containers:

```bash
for service in server signalserver postgres redis proxy guard zitadel; do
  container_id=$(docker compose -f /root/beskar/docker/.generated/compose.yml -p "$APP_PROJECT" ps -q "$service")
  docker inspect "$container_id" --format '{{.Name}} driver={{.HostConfig.LogConfig.Type}} path={{.LogPath}}'
done
```

The following setup requires **rootful Docker**, the `json-file` driver, and log paths under `/var/lib/docker/containers/`. The repository's production templates configure `json-file`. If your paths/driver differ, adapt the mount/input before continuing.

### 6.2 Create the Fluent Bit files

Create `/root/newrelic-infra/parsers.conf`:

```ini
[PARSER]
    Name docker_json
    Format json
    Time_Key time
    Time_Format %Y-%m-%dT%H:%M:%S.%L
    Time_Keep On

[PARSER]
    Name application_json
    Format json
```

Create `/root/newrelic-infra/fluent-bit.conf`:

```ini
[SERVICE]
    Flush 5
    Log_Level info
    Parsers_File /fluent-bit/etc/beskar-parsers.conf

@INCLUDE /fluent-bit/etc/beskar-inputs.conf

[FILTER]
    Name parser
    Match beskar.*
    Key_Name log
    Parser application_json
    Reserve_Data On
    Preserve_Key On

[FILTER]
    Name modify
    Match beskar.*
    Rename log message
    Add environment staging

[OUTPUT]
    Name newrelic
    Match beskar.*
    licenseKey REPLACE_WITH_INGEST_LICENSE_KEY
    endpoint https://log-api.newrelic.com/log/v1
```

Replace the license key. Use `https://log-api.eu.newrelic.com/log/v1` for EU or `https://log-api.jp.nr-data.net/log/v1` for Japan.

Generate an input for each running service in the terminal where you set `APP_PROJECT` in Step 1.2:

```bash
(
  set -eu
  : > "/root/newrelic-infra/inputs.conf.tmp"
  for service in server signalserver postgres redis proxy guard zitadel; do
    container_id=$(docker compose -f /root/beskar/docker/.generated/compose.yml -p "$APP_PROJECT" ps -q "$service")
    test -n "$container_id"
    log_path=$(docker inspect "$container_id" --format '{{.LogPath}}')
    case "$log_path" in
      /var/lib/docker/containers/*/*-json.log) ;;
      *) echo "Unsupported log path for $service" >&2; exit 1 ;;
    esac
    cat >> "/root/newrelic-infra/inputs.conf.tmp" <<INPUT
[INPUT]
    Name tail
    Path $log_path
    Tag beskar.$service
    Parser docker_json
    DB /state/$service.db
    Read_from_Head Off
    Mem_Buf_Limit 10MB
    Skip_Long_Lines On
    Refresh_Interval 5

[FILTER]
    Name modify
    Match beskar.$service
    Add service $service

INPUT
  done
  mv "/root/newrelic-infra/inputs.conf.tmp" "/root/newrelic-infra/inputs.conf"
)
chmod 600 "/root/newrelic-infra/fluent-bit.conf"
```

### 6.3 Start the forwarder

Add this service under `services:` in `/root/newrelic-infra/docker-compose.yaml`, beside `agent`:

```yaml
  logs:
    image: newrelic/logging-fluent-bit:latest
    user: "0:0"
    volumes:
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - ./fluent-bit.conf:/fluent-bit/etc/fluent-bit.conf:ro
      - ./parsers.conf:/fluent-bit/etc/beskar-parsers.conf:ro
      - ./inputs.conf:/fluent-bit/etc/beskar-inputs.conf:ro
      - log_state:/state
    restart: unless-stopped
```

Add this top-level section at the end of the same file:

```yaml
volumes:
  log_state:
```

Run:

```bash
docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" config --quiet
docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" up -d logs
docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" logs --tail 100 logs
```

After testing, pin this image to its downloaded digest too, using `docker image inspect newrelic/logging-fluent-bit:latest --format '{{index .RepoDigests 0}}'`.

### 6.4 Test a real log

Repeat the `pg_sleep` test from Step 3. Then run in New Relic:

```sql
FROM Log SELECT * WHERE service = 'postgres' AND message LIKE '%pg_sleep%'
SINCE 15 minutes ago LIMIT 20
```

**Expected:** the slow query log. Generate traffic through the site, then query `FROM Log SELECT count(*) FACET service SINCE 15 minutes ago` to check the other services. Quiet services may have no new logs yet.

**After recreating any app container:** rerun the input-generation block in 6.2, then run `docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" restart logs`. Docker gives recreated containers new log paths. This simple setup does not discover those changes automatically.

This forwards new logs and stores read offsets. It does not guarantee delivery during long outages, and it does not collect journald/Docker daemon logs. Do not enable another forwarding pipeline for these same container logs.

Source: [New Relic Fluent Bit image and output options](https://docs.newrelic.com/docs/logs/forward-logs/fluent-bit-plugin-log-forwarding/).

## 7. Add vendor-neutral Go monitoring with OpenTelemetry

Use this path for both Go services:

```text
Go OpenTelemetry SDK → OTLP → OpenTelemetry Collector → New Relic
```

The application code uses OpenTelemetry APIs. The Collector holds the backend endpoint and key. To change providers later, update the Collector exporter. Dashboards, alerts, and backend-specific features still need migration.

Do not install the New Relic Go agent alongside this setup. If you followed an older version of this guide, remove its Go agent initialization, middleware, pgx tracer, Redis hooks, and `NEW_RELIC_*` application settings as you replace them below. Keep one instrumentation path per operation.

### 7.1 Add the Collector to your monitoring Compose file

In the existing Beskar env file (`/root/beskar/docker/env/deploy.env`, or your actual filename), add:

```dotenv
NEW_RELIC_LICENSE_KEY='REPLACE_WITH_INGEST_LICENSE_KEY'
NEW_RELIC_OTLP_ENDPOINT=https://otlp.nr-data.net
```

Use `https://otlp.eu01.nr-data.net` for EU or `https://otlp.jp.nr-data.net` for Japan. These settings are for the Collector; do not add vendor credentials to the Go application's telemetry initializer.

Create `/root/newrelic-infra/otel-collector.yml`:

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 256
    spike_limit_mib: 64
  batch: {}
exporters:
  otlphttp/backend:
    endpoint: ${env:NEW_RELIC_OTLP_ENDPOINT}
    headers:
      api-key: ${env:NEW_RELIC_LICENSE_KEY}
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlphttp/backend]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlphttp/backend]
```

Add this beside `agent` under `services` in `/root/newrelic-infra/docker-compose.yaml`:

```yaml
  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    command: ["--config=/etc/otelcol-contrib/config.yaml"]
    env_file:
      - /root/beskar/docker/env/deploy.env
    volumes:
      - ./otel-collector.yml:/etc/otelcol-contrib/config.yaml:ro
    mem_limit: 512m
    networks:
      - beskar-network
    restart: unless-stopped
```

Do not publish port 4318 to the host. Both Go services reach `http://otel-collector:4318` through `beskar-network`.

```bash
docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" config --quiet
docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" run --rm --no-deps otel-collector validate --config=/etc/otelcol-contrib/config.yaml
docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" up -d otel-collector
```

After staging validation, pin the Collector image digest, as with the other monitoring images. This example has batching and retries, but no durable disk queue; prolonged outages can lose telemetry.

### 7.2 Install the OpenTelemetry packages

Run for the API module:

```bash
cd /root/beskar/server
go get go.opentelemetry.io/otel go.opentelemetry.io/otel/sdk go.opentelemetry.io/otel/sdk/metric
go get go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp
go get go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp github.com/exaring/otelpgx
go get github.com/redis/go-redis/extra/redisotel/v9
```

Keep the resolved versions in `go.mod` and `go.sum`. Select versions compatible with the project's Go version and existing pgx/go-redis dependencies; inspect dependency upgrades before deploying.

### 7.3 Initialize tracing and metrics

Create `/root/beskar/server/core/telemetry.go`:

```go
package core

import (
    "context"
    "errors"

    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
    "go.opentelemetry.io/otel/propagation"
    "go.opentelemetry.io/otel/sdk/resource"
    sdkmetric "go.opentelemetry.io/otel/sdk/metric"
    sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func InitTelemetry(ctx context.Context) (func(context.Context) error, error) {
    res, err := resource.New(ctx, resource.WithFromEnv(), resource.WithTelemetrySDK())
    if err != nil {
        return nil, err
    }
    traceExporter, err := otlptracehttp.New(ctx)
    if err != nil {
        return nil, err
    }
    metricExporter, err := otlpmetrichttp.New(ctx)
    if err != nil {
        _ = traceExporter.Shutdown(ctx)
        return nil, err
    }
    tp := sdktrace.NewTracerProvider(sdktrace.WithResource(res), sdktrace.WithBatcher(traceExporter))
    mp := sdkmetric.NewMeterProvider(
        sdkmetric.WithResource(res),
        sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExporter)),
    )
    otel.SetTracerProvider(tp)
    otel.SetMeterProvider(mp)
    otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
        propagation.TraceContext{}, propagation.Baggage{},
    ))
    return func(ctx context.Context) error {
        return errors.Join(tp.Shutdown(ctx), mp.Shutdown(ctx))
    }, nil
}
```

In `server/main.go`, immediately after loading application configuration and before database/Redis clients are created, call:

```go
shutdownOTel, err := core.InitTelemetry(appContext)
if err != nil {
    logger().Fatal("OpenTelemetry setup failed", zap.Error(err))
}
defer func() {
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    if err := shutdownOTel(ctx); err != nil {
        logger().Error("OpenTelemetry shutdown failed", zap.Error(err))
    }
}()
```

Use a fresh shutdown context because `appContext` is cancelled on SIGTERM. Keep the existing HTTP graceful shutdown.

In both `/root/beskar/docker/templates/compose.http.yml.tmpl` and `/root/beskar/docker/templates/compose.https.yml.tmpl`, append these to `server.environment`:

```yaml
      OTEL_SERVICE_NAME: beskar-api-staging
      OTEL_RESOURCE_ATTRIBUTES: deployment.environment.name=staging
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
      OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: delta
```

Use production service/environment names in production. The exporter constructors above read standard OTLP environment settings. The app needs no New Relic license key.

### 7.4 Instrument HTTP and Chi route names

In `server/main.go`, import:

```go
"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
"go.opentelemetry.io/otel/attribute"
"go.opentelemetry.io/otel/trace"
```

After `r := chi.NewRouter()`, add this middleware before routes are registered:

```go
r.Use(func(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
        next.ServeHTTP(w, req)
        pattern := chi.RouteContext(req.Context()).RoutePattern()
        if pattern != "" {
            span := trace.SpanFromContext(req.Context())
            span.SetName(req.Method + " " + pattern)
            span.SetAttributes(attribute.String("http.route", pattern))
            labeler, _ := otelhttp.LabelerFromContext(req.Context())
            labeler.Add(attribute.String("http.route", pattern))
        }
    })
})
```

Change the existing HTTP server's `Handler: r` to:

```go
Handler: otelhttp.NewHandler(r, "beskar-api"),
```

This starts the HTTP server span; the Chi middleware adds the resolved route pattern after routing. Check mounted routes, unmatched requests, SSE streaming, and response-writer behavior in staging. Do not use raw document IDs as span names.

Wrap outbound HTTP client transports with `otelhttp.NewTransport(existingTransport)` and use `http.NewRequestWithContext` with the active request context. For gRPC clients, use the OpenTelemetry `otelgrpc` stats handler rather than a vendor agent.

### 7.5 Instrument PostgreSQL and Redis

In `/root/beskar/server/core/postgres.go`, import `github.com/exaring/otelpgx`. After successful `pgxpool.ParseConfig(...)`, add:

```go
dbConfig.ConnConfig.Tracer = otelpgx.NewTracer()
```

Do not enable `WithIncludeQueryParameters`. SQL text can still contain literal values; disable statement capture with `otelpgx.WithDisableSQLStatementInAttributes()` if those statements are unsafe to export. Slow-query server logs from Step 3 remain separate.

In both `/root/beskar/server/core/browser_session_redis.go` and `/root/beskar/server/editor/pageevents/pageevents.go`, import:

```go
"github.com/redis/go-redis/extra/redisotel/v9"
```

Immediately after creating each Redis client, attach instrumentation and handle errors through that function's normal error path:

```go
if err := redisotel.InstrumentTracing(client); err != nil {
    // Close the new client and return/report this setup error.
}
if err := redisotel.InstrumentMetrics(client); err != nil {
    // Close the new client and return/report this setup error.
}
```

Use the actual client variable (`client` or `c`). Review/disable Redis command-argument capture using the selected redisotel version's options if commands contain sensitive values.

Pass `req.Context()` through handlers into database/Redis calls. Operations using `context.Background()` do not inherit the request's span. Optionally call `otelpgx.RecordStats(pool)` after creating the pool to emit pool metrics.

### 7.6 Add portable trace fields to local JSON logs

Continue using Zap and the existing Fluent Bit log pipeline. In `/root/beskar/server/core/logger.go`, import `context` and `go.opentelemetry.io/otel/trace`, then add:

```go
func RequestLogger(ctx context.Context) *zap.Logger {
    requestLogger := Logger.With(zap.String("service", "server"))
    sc := trace.SpanContextFromContext(ctx)
    if !sc.IsValid() {
        return requestLogger
    }
    return requestLogger.With(
        zap.String("trace.id", sc.TraceID().String()),
        zap.String("span.id", sc.SpanID().String()),
    )
}
```

Use `core.RequestLogger(req.Context())` in request handlers. Apply the same context-derived fields to the auth/slog logger when updating those handlers. Existing global log calls do not gain trace context automatically.

In the Beskar deployment env file set `SERVER_LOG_TO_FILES=false` and `SERVER_LOG_LEVEL=info`. Do not also export those same records through an OTel log bridge while Fluent Bit forwards them. The `trace.id`/`span.id` field spelling here matches the existing New Relic log pipeline; the IDs come from OpenTelemetry.

### 7.7 Build, deploy, and check

```bash
(cd /root/beskar/server && go mod tidy && go test ./...)
bash /root/beskar/docker/scripts/validate-config.sh --env "$DEPLOY_ENV"
docker compose -f /root/beskar/docker/.generated/compose.yml -p "$APP_PROJECT" up -d --build --no-deps server
docker compose -f /root/newrelic-infra/docker-compose.yaml -p "$MONITOR_PROJECT" logs --tail 100 otel-collector
```

Regenerate Fluent Bit inputs using Step 6.2 and restart `logs` after container recreation. Open the app and a document, then run:

```sql
FROM Span SELECT count(*) WHERE service.name = 'beskar-api-staging' SINCE 15 minutes ago
```

**Expected:** spans for real requests, plus PostgreSQL/Redis spans for calls they make. Inspect the service in New Relic's OpenTelemetry/APM views. Native-agent `Transaction` queries are not interchangeable with OTLP `Span`/`Metric` queries.

HTTP/client metrics come from the instrumented libraries. Go runtime metrics and application-specific queue/worker metrics need their own OpenTelemetry instrumentation; SDK initialization alone does not create every APM panel.

Sources: [OpenTelemetry Go exporters](https://opentelemetry.io/docs/languages/go/exporters/), [pgx instrumentation](https://github.com/exaring/otelpgx), [Redis instrumentation](https://github.com/redis/go-redis/tree/master/extra/redisotel), [New Relic OTLP endpoints](https://docs.newrelic.com/docs/opentelemetry/best-practices/opentelemetry-otlp/).

## 8. Add OpenTelemetry to the signal server

### 8.1 Initialize the separate Go module

Install the same OTel SDK/exporter packages from Step 7.2 in `/root/beskar/signalserver`; the signal server needs redisotel and outbound HTTP instrumentation, but no pgx package.

Copy the `InitTelemetry` helper into `/root/beskar/signalserver/telemetry.go`, changing `package core` to `package main`. Both modules use the same standard OTel configuration, without New Relic imports.

Add the same environment settings under `signalserver.environment` in both Compose templates, with `OTEL_SERVICE_NAME: beskar-signal-staging`.

Call `InitTelemetry` at startup before `initSignalRedis()`, and defer shutdown with a fresh timeout context, as in Step 7.3. Replace the existing `log.Fatal(http.ListenAndServe(...))` with a signal-aware `http.Server` lifecycle like `/root/beskar/server/main.go`; `log.Fatal` skips deferred telemetry flushing. HTTP shutdown does not wait for upgraded WebSockets, so test reconnects during rollout.

In `initSignalRedis()`, call `redisotel.InstrumentTracing(c)` and `redisotel.InstrumentMetrics(c)` after creating the Redis client. Handle setup failures before using the client.

### 8.2 Create short message spans

In `/root/beskar/signalserver/main.go`:

1. Move the message-processing body of `readPump` into a new `processIncomingMessage` method: start at the binary-message branch and include the complete `switch msg.Type` block.
2. Change the moved loop-level `continue` statements to `return`.
3. Keep `ReadMessage()` and its error check in the original loop.
4. Call the new method once for each successfully read message.

Use this method signature and put the moved processing code after the span initialization:

```go
func (c *Client) processIncomingMessage(h *Hub, messageType int, payload []byte) {
    ctx, span := otel.Tracer("beskar/signal").Start(context.Background(), "WebSocket/Message")
    defer span.End()
    _ = ctx // Use this context for synchronous work performed by this message.
    // Move the existing binary forwarding and message switch here.
}
```

Import `go.opentelemetry.io/otel`. The call inside `readPump` is:

```go
c.processIncomingMessage(h, messageType, payload)
```

This creates independent message spans. Do not keep a single span open for an hours-long socket. Add bounded message types to names if useful; omit room/client/document IDs from metric dimensions and span names.

For watchdog work, add this at the beginning of `watchdogTick(ctx)`:

```go
ctx, span := otel.Tracer("beskar/signal").Start(ctx, "Signal/Watchdog")
defer span.End()
```

In each goroutine in `redisSetRoomLeader`, `redisAddRoomMember`, and `redisRemoveRoomMember`, start a separate span, then use its context as the timeout's parent:

```go
spanCtx, span := otel.Tracer("beskar/signal").Start(context.Background(), "Signal/RedisRoomUpdate")
defer span.End()
ctx, cancel := context.WithTimeout(spanCtx, 2*time.Second)
defer cancel()
```

In the existing Redis error blocks, record errors and set span status:

```go
span.RecordError(err)
span.SetStatus(codes.Error, "Redis operation failed")
```

Import `go.opentelemetry.io/otel/codes`. These asynchronous updates are independent traces. To connect them to a message later, explicitly pass a live context or use a span link for detached work. WebSocket messages and Redis Pub/Sub do not carry W3C trace context automatically.

### 8.3 Build and verify

```bash
(cd /root/beskar/signalserver && go mod tidy && go test ./...)
bash /root/beskar/docker/scripts/validate-config.sh --env "$DEPLOY_ENV"
docker compose -f /root/beskar/docker/.generated/compose.yml -p "$APP_PROJECT" up -d --build --no-deps signalserver
```

Regenerate Fluent Bit inputs and restart `logs`. Edit the same document from two clients. Check:

```sql
FROM Span SELECT count(*) FACET name
WHERE service.name = 'beskar-signal-staging' SINCE 15 minutes ago
```

**Expected:** message/watchdog/Redis spans when those paths run, and working collaboration/reconnects. Room/connection counts and send-queue metrics still require explicit OTel instruments in the hub.

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

In `/root/beskar/server/main.go`, extend the existing CORS `AllowedHeaders` list with:

```go
"traceparent", "tracestate", "newrelic"
```

The Go services use the W3C TraceContext propagator from Step 7. Browser-to-API linking depends on the Browser agent emitting `traceparent` for that origin. Keep the existing entries. NGINX normally forwards these request headers; remove any configuration that clears them. Ordinary Browser HTTP tracing does not trace WebSocket message contents.

Rebuild:

```bash
bash /root/beskar/docker/scripts/validate-config.sh --env "$DEPLOY_ENV"
docker compose -f /root/beskar/docker/.generated/compose.yml -p "$APP_PROJECT" up -d --build --no-deps ui server
```

Regenerate Fluent Bit inputs and restart `logs`.

### 9.3 Verify in the browser

1. Open the staging site and reload it with browser developer tools open.
2. Check Network for successful requests to New Relic's collector. If blocked by CSP, allow the domains required by your generated snippet/region.
3. Sign in and open a document to generate API calls.
4. In New Relic, open `beskar-web-staging` and inspect an AJAX request with distributed tracing data.
5. Follow its trace into `beskar-api-staging`.

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
WHERE service.name = 'beskar-api-staging' FACET name TIMESERIES SINCE 30 minutes ago
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
   WHERE service.name = 'beskar-api-staging' AND span.kind = 'server'
   ```

3. Inspect a server span first with `FROM Span SELECT * WHERE service.name = 'beskar-api-staging' SINCE 15 minutes ago LIMIT 5`. Confirm `span.kind` and the HTTP status attribute match the query; older semantic conventions can use `http.status_code`. Span-based percentages describe sampled requests. Prefer HTTP request metrics for production error-rate alerts once their metric names are confirmed.
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
6. Render/validate, recreate the affected services during a planned window, restart the agent, and repeat Steps 2–5 checks. Regenerate log inputs after container recreation.

Do not publish those ports on `0.0.0.0`. This optional change restarts the affected containers and requires rechecking database and proxy availability.

## Files edited in this walkthrough

| Location | Purpose |
| --- | --- |
| `/root/newrelic-infra/` outside Git | Infrastructure/OTel Collector/log configurations and credentials |
| Both `/root/beskar/docker/templates/compose.*.yml.tmpl` files | Slow-query settings and standard OTEL environment variables |
| Both `/root/beskar/docker/templates/nginx.*.conf.tmpl` files | Private status port and access logs |
| `$DEPLOY_ENV` (existing application env file) | API log output and level |
| `/root/beskar/server/`, `/root/beskar/signalserver/` | Go tracing code and dependencies |
| `/root/beskar/ui/index.html` | Generated Browser snippet |

`bash /root/beskar/docker/scripts/validate-config.sh --env "$DEPLOY_ENV"` renders templates and validates the result. Do not hand-edit `/root/beskar/docker/.generated/`; the next render overwrites it.
