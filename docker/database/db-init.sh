#!/bin/bash
#=============================================
# This is bash script to initialise database.
#=============================================

set -euo pipefail
umask 077

echo "initialising databases"

DIRECTORY=$PWD
WD=$DIRECTORY/docker/database
LQB=liquibasebin

echo "running from 📂 $DIRECTORY"

# java -version

# download liquibase
if [ ! -d "$WD/$LQB" ]
then
    echo "liquibase does not exist, downloading ... ⚙️"
    mkdir -p "$WD/$LQB"
    curl -kLSs https://github.com/liquibase/liquibase/releases/download/v4.27.0/liquibase-4.27.0.zip -o "$WD/$LQB/liquibase.zip"
    unzip "$WD/$LQB/liquibase.zip" -d "$WD/$LQB"
fi

LQ=$WD/$LQB/liquibase # liquibase command

DB_HOST=${DB_HOST:-postgres}
DB_PORT=${DB_PORT:-5432}
DB_ROOT=${DB_ROOT:-postgres}
DB_ROOT_USER=${DB_ROOT_USER:-admin}
DB_ROOT_PASS=${DB_ROOT_PASS:-password}
DB_APP_NAME=${DB_APP_NAME:-beskar}
DB_AUTH_NAME=${DB_AUTH_NAME:-auth}
DB_BESKAR_ADMIN_USER=${DB_BESKAR_ADMIN_USER:-beskar_admin} # run liquibase migrations with this user
DB_BESKAR_ADMIN_USER_PWD=${DB_BESKAR_ADMIN_USER_PWD:-beskar_admin_pwd}
DB_BESKAR_APP_USER=${DB_BESKAR_APP_USER:-app_user}
DB_BESKAR_APP_USER_PWD=${DB_BESKAR_APP_USER_PWD:-app_user_pwd}
DB_SEARCH_NAME=${DB_SEARCH_NAME:-search}
DB_SEARCH_WRITER_USER=${DB_SEARCH_WRITER_USER:-search_writer}
: "${DB_SEARCH_WRITER_USER_PWD:?DB_SEARCH_WRITER_USER_PWD is required}"
# Identifiers are interpolated into SQL; restrict them to ordinary PostgreSQL names.
for identifier in "$DB_SEARCH_NAME" "$DB_SEARCH_WRITER_USER"; do
    if [[ ! "$identifier" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; then
        echo "Invalid search database or writer identifier" >&2
        exit 1
    fi
done
if [[ "$DB_SEARCH_NAME" == "$DB_APP_NAME" || "$DB_SEARCH_NAME" == "$DB_AUTH_NAME" || "$DB_SEARCH_NAME" == "$DB_ROOT" ]]; then
    echo "Search must use a separate database" >&2
    exit 1
fi
DB_SEARCH_WRITER_USER_PWD_SQL=${DB_SEARCH_WRITER_USER_PWD//\'/\'\'}
TAG=$(date +"%s")

until pg_isready -h "$DB_HOST" -p "$DB_PORT"; do
    echo "waiting for postgres container to be ready..."
    sleep 1
done

temp_properties=()
trap 'for file in "${temp_properties[@]}"; do rm -f "$file"; done' EXIT

echo "running migrations with tag $TAG"


function create_temp_liquibase_file() {
    local destination="$1/liquibase-temp.properties"
    temp_properties+=("$destination" "$destination.next")
    cp "$1/$2" "$destination"
}

function copy_data_to_liquibaes_prop_file() {
    local name value
    for name in DB_HOST DB_PORT DB_ROOT DB_ROOT_USER DB_ROOT_PASS DB_APP_NAME DB_AUTH_NAME \
        DB_BESKAR_ADMIN_USER DB_BESKAR_ADMIN_USER_PWD DB_BESKAR_APP_USER DB_BESKAR_APP_USER_PWD \
        DB_SEARCH_NAME DB_SEARCH_WRITER_USER DB_SEARCH_WRITER_USER_PWD_SQL; do
        value=${!name}
        # Preserve backslashes in Java properties, then escape sed replacement syntax.
        value=${value//\\/\\\\}
        value=${value//\\/\\\\}
        value=${value//&/\\&}
        value=${value//|/\\|}
        sed "s|@$name@|$value|g" "$1/liquibase-temp.properties" > "$1/liquibase-temp.properties.next"
        mv "$1/liquibase-temp.properties.next" "$1/liquibase-temp.properties"
    done
}

function run_migrations() {
    local directory="$1" properties="$2"
    cd "$directory"
    create_temp_liquibase_file "$directory" "$properties"
    copy_data_to_liquibaes_prop_file "$directory"
    "$LQ" --defaultsFile=liquibase-temp.properties update
    # A fresh database has no changelog table to tag until its first update.
    "$LQ" --defaultsFile=liquibase-temp.properties tag "$TAG"
}

# Provision databases and roles before applying their schemas.
run_migrations "$DIRECTORY/db/init" liquibase.properties
run_migrations "$DIRECTORY/db/init" auth.properties
run_migrations "$DIRECTORY/db/init" search.properties
run_migrations "$DIRECTORY/db/beskar" liquibase.properties
run_migrations "$DIRECTORY/db/search" liquibase.properties

echo "databases initialised with schema"
