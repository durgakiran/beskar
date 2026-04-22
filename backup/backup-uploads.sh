#!/bin/bash
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"  # resolves to beskar/ root
B2_ENDPOINT="https://s3.us-west-004.backblazeb2.com"  # update to your bucket's region endpoint
B2_BUCKET="s3://your-beskar-backups/uploads"           # update to your bucket name
# ─────────────────────────────────────────────────────────────────────────────

echo "[$(date)] Starting uploads sync..."

# Sync uploads directory (incremental — only new/changed files are transferred)
aws s3 sync "$PROJECT_DIR/uploads/" "$B2_BUCKET/" \
  --endpoint-url "$B2_ENDPOINT" \
  --profile b2

# Sync Go server's public directory
aws s3 sync "$PROJECT_DIR/server/public/" "$B2_BUCKET/server-public/" \
  --endpoint-url "$B2_ENDPOINT" \
  --profile b2

echo "[$(date)] Uploads sync complete."
