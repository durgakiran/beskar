# Beskar Backup Runbook

This directory contains the backup scripts for Beskar.

## PostgreSQL Backup

`backup/backup-postgres.sh` is a host-run backup script for the env-driven
production Docker stack. It is provider-agnostic across `S3-compatible`
storage backends and currently expects configuration values such as:

- `BACKUP_S3_ENDPOINT`
- `BACKUP_S3_BUCKET`
- `BACKUP_S3_PREFIX`
- `BACKUP_AWS_ACCESS_KEY_ID`
- `BACKUP_AWS_SECRET_ACCESS_KEY`
- `BACKUP_ENCRYPTION_KEY_FILE`

The initial storage target can be `E2E Object Storage`, but changing to another
S3-compatible provider should only require new config values and credentials.

### Scope

The script backs up:

- `postgres`
- `DB_APP_NAME` default `beskar`
- `DB_AUTH_NAME` default `auth`
- `DB_ZITADEL_NAME` default `zitadel`
- cluster globals via `pg_dumpall --globals-only`

This matches the current repo assumptions:

- `postgres` may contain app-init Liquibase state
- `beskar` contains main application data and Liquibase changelog tables
- `auth` contains auth-related data and Liquibase changelog tables
- `zitadel` contains Zitadel data
- `globals-only` captures roles and memberships

### Encryption

Backups are encrypted locally before upload using `openssl enc` and a
host-managed symmetric key file. Only `.enc` artifacts are uploaded.

Plaintext dump files are written to a temporary working directory and deleted
immediately after successful encryption.

The encryption is portable across systems. Any other machine can decrypt a
backup as long as it has:

- the encrypted backup artifact
- the same key file referenced by `BACKUP_ENCRYPTION_KEY_FILE`
- `openssl`
- the same decryption parameters

The current backup format uses:

- cipher: `aes-256-cbc`
- KDF: `PBKDF2`
- iterations: `200000`

Example decryption on another system:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in /tmp/beskar_20260420T023000Z.dump.enc \
  -out /tmp/beskar_20260420T023000Z.dump \
  -pass file:/path/to/openssl-backup.key
```

This means the backups are not tied to the production host, which is useful for
disaster recovery. It also means that anyone with the key file can decrypt all
backups encrypted with that key, so store it like a high-value secret and keep
at least one secure copy outside the production server.

### Retention

The script keeps:

- `7` daily snapshots
- `4` weekly snapshots
- `6` monthly snapshots

Retention is applied across full backup snapshots, not individual objects, and
pruning only runs after all dumps and uploads complete successfully.

In plain terms, this means:

- keep the newest backup from each of the last `7` days
- then keep the newest backup from each of the last `4` weeks
- then keep the newest backup from each of the last `6` months

If the backup runs once per day, the result is roughly:

- the last `7` days are recoverable day-by-day
- older backups are reduced to one per week for about a month
- older backups after that are reduced to one per month for six months

Each backup run produces a full snapshot timestamp covering all of:

- `postgres`
- `beskar`
- `auth`
- `zitadel`
- `globals`

The retention policy keeps or deletes that snapshot as a group, so all files
from a given backup timestamp remain aligned.

### Required Host Tools

- `docker`
- `aws`
- `openssl`

The script uses Postgres tooling from the running `postgres` service, so you do
not need `pg_dump` installed on the host.

### Configuration

Set the required backup values in your deployment env file or reference a
separate file with `BACKUP_CONFIG_FILE`.

Example values in `docker/env/<environment>.env`:

```env
BACKUP_S3_ENDPOINT=https://objectstore.e2enetworks.net
BACKUP_S3_BUCKET=beskar-backups
BACKUP_S3_PREFIX=postgres
BACKUP_AWS_ACCESS_KEY_ID=your-access-key
BACKUP_AWS_SECRET_ACCESS_KEY=your-secret-key
BACKUP_ENCRYPTION_KEY_FILE=/opt/beskar/backup/openssl-backup.key
BACKUP_TMP_DIR=/var/tmp/beskar-postgres-backup
BACKUP_RETENTION_DAILY=7
BACKUP_RETENTION_WEEKLY=4
BACKUP_RETENTION_MONTHLY=6
BACKUP_LOCK_FILE=/var/tmp/beskar-postgres-backup.lock
```

Create a strong local encryption key file and lock it down:

```bash
mkdir -p /opt/beskar/backup
openssl rand -base64 48 > /opt/beskar/backup/openssl-backup.key
chmod 600 /opt/beskar/backup/openssl-backup.key
```

### Run Manually

```bash
./backup/backup-postgres.sh --env docker/env/prod.env
```

To keep backup-specific values outside the main env file:

```bash
./backup/backup-postgres.sh \
  --env docker/env/prod.env \
  --backup-config /opt/beskar/backup/postgres-backup.env
```

### Cron

Example daily cron entry:

```cron
0 2 * * * cd /path/to/beskar && ./backup/backup-postgres.sh --env docker/env/prod.env >> /var/log/beskar-postgres-backup.log 2>&1
```

If your VM does not have `crontab`, use a `systemd timer` instead.

### Systemd Timer

Create `/etc/systemd/system/beskar-postgres-backup.service`:

```ini
[Unit]
Description=Beskar PostgreSQL backup
Wants=network-online.target
After=network-online.target docker.service
Requires=docker.service

[Service]
Type=oneshot
User=kiran
WorkingDirectory=/path/to/beskar
ExecStart=/path/to/beskar/backup/backup-postgres.sh --env /path/to/beskar/docker/env/prod.env
```

If you use a separate backup config file:

```ini
ExecStart=/path/to/beskar/backup/backup-postgres.sh --env /path/to/beskar/docker/env/prod.env --backup-config /opt/beskar/backup/postgres-backup.env
```

Create `/etc/systemd/system/beskar-postgres-backup.timer`:

```ini
[Unit]
Description=Run Beskar PostgreSQL backup daily

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

Then enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now beskar-postgres-backup.timer
```

Useful commands:

```bash
systemctl status beskar-postgres-backup.timer
systemctl list-timers --all | grep beskar-postgres-backup
sudo systemctl start beskar-postgres-backup.service
journalctl -u beskar-postgres-backup.service -n 200 --no-pager
```

Replace `User=kiran` and `/path/to/beskar` with the real user and absolute path
on the VM. The chosen user must be able to access Docker, the repo, the env
file, and the encryption key file.

## Restore Procedure

### 1. Download The Encrypted Artifact

```bash
aws s3 cp \
  s3://beskar-backups/postgres/prod/2026/04/20/beskar_20260420T023000Z.dump.enc \
  /tmp/beskar_20260420T023000Z.dump.enc \
  --endpoint-url https://objectstore.e2enetworks.net
```

### 2. Decrypt Locally

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in /tmp/beskar_20260420T023000Z.dump.enc \
  -out /tmp/beskar_20260420T023000Z.dump \
  -pass file:/opt/beskar/backup/openssl-backup.key
```

For globals:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in /tmp/globals_20260420T023000Z.sql.enc \
  -out /tmp/globals_20260420T023000Z.sql \
  -pass file:/opt/beskar/backup/openssl-backup.key
```

### 3. Bootstrap A Fresh Stack

Bring up the Postgres service and run the normal env-driven initialization flow
so the baseline databases and users exist:

```bash
./docker/scripts/deploy.sh --env docker/env/prod.env
```

If you only want the database layer first, use the generated compose config to
start `postgres` and run `db-init`.

### 4. Restore Globals If Needed

```bash
docker compose -f docker/.generated/compose.yml -p beskar-prod exec -T postgres \
  psql -h localhost -U admin -d postgres < /tmp/globals_20260420T023000Z.sql
```

### 5. Restore Each Database

Example for `beskar`:

```bash
cat /tmp/beskar_20260420T023000Z.dump | \
docker compose -f docker/.generated/compose.yml -p beskar-prod exec -T postgres \
  pg_restore -h localhost -U admin -d beskar --clean --if-exists --no-owner --no-privileges
```

Repeat for:

- `postgres`
- `zitadel`
- `auth`
- `beskar`

Restore only the databases relevant to the recovery scenario if you do not need
a full-cluster recovery.

## Security Checklist

- Use a dedicated access key restricted to the backup bucket or prefix only.
- Keep the encryption key file off the repo and readable only by the account
  that runs the backup job.
- Test a restore regularly.
- Treat loss of the encryption key as loss of backup recoverability.
