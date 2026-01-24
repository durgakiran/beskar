#!/bin/bash
#=============================================
# This is bash script to initialise database.
#=============================================

echo "initialising core database"

DIRECTORY=$PWD
WD=$DIRECTORY/docker/database
LQB=liquibasebin

echo "running from 📂 $DIRECTORY"

# java -version

# download liquibase
if [ ! -d $WD/$LQB ]
then
    echo "liquibase does not exist, downloading ... ⚙️"
    mkdir $WD/$LQB
    curl -kLSs https://github.com/liquibase/liquibase/releases/download/v4.27.0/liquibase-4.27.0.zip -o $WD/$LQB/liquibase.zip
    unzip $WD/$LQB/liquibase.zip -d $WD/$LQB
fi

LQ=$WD/$LQB/liquibase # liquibase command

# check if postgres is up and healthy
until pg_isready -h postgres -p 5432
do
    echo "waiting for postgres container to be ready... 🙁"
    sleep 1
done

echo "postgres is ready, running migrations... 🥳"
DB_HOST=${DB_HOST:-postgres}
DB_PORT=${DB_PORT:-5432}
DB_ROOT=${DB_ROOT:-postgres}
DB_ROOT_USER=${DB_ROOT_USER:-admin}
DB_ROOT_PASS=${DB_ROOT_PASS:-password}
DB_BESKAR_ADMIN_USER=${DB_BESKAR_ADMIN_USER:-beskar_admin} # run liquibase migrations with this user
DB_BESKAR_ADMIN_USER_PWD=${DB_BESKAR_ADMIN_USER_PWD:-beskar_admin_pwd}
DB_BESKAR_APP_USER=${DB_BESKAR_APP_USER:-app_user}
DB_BESKAR_APP_USER_PWD=${DB_BESKAR_APP_USER_PWD:-app_user_pwd}
TAG=$(echo date +"%s")

echo "running migrations with tag $TAG"


function create_temp_liquibase_file() {
    echo "creating liquibae-temp.properties in folder $1"
    rm -f $1/liquibase-temp.properties
    touch $1/liquibase-temp.properties
    cp $1/$2 $1/liquibase-temp.properties
}

function copy_data_to_liquibaes_prop_file() {
    echo "copying properties to liquibase-temp.properties in folder $1"
    # copy database host
    sed -i "s/@DB_HOST@/$DB_HOST/" $1/liquibase-temp.properties
    sed -i "s/@DB_PORT@/$DB_PORT/" $1/liquibase-temp.properties
    sed -i "s/@DB_ROOT@/$DB_ROOT/" $1/liquibase-temp.properties
    sed -i "s/@DB_ROOT_USER@/$DB_ROOT_USER/" $1/liquibase-temp.properties
    sed -i "s/@DB_ROOT_PASS@/$DB_ROOT_PASS/" $1/liquibase-temp.properties
    sed -i "s/@DB_BESKAR_ADMIN_USER@/$DB_BESKAR_ADMIN_USER/" $1/liquibase-temp.properties
    sed -i "s/@DB_BESKAR_ADMIN_USER_PWD@/$DB_BESKAR_ADMIN_USER_PWD/" $1/liquibase-temp.properties
    sed -i "s/@DB_BESKAR_APP_USER@/$DB_BESKAR_APP_USER/" $1/liquibase-temp.properties
    sed -i "s/@DB_BESKAR_APP_USER_PWD@/$DB_BESKAR_APP_USER_PWD/" $1/liquibase-temp.properties
}

# TODO: we should run these scripts in a postgres container where psql is installed.
# run init scripts
INIT_DIRECTORY=$DIRECTORY/db/init
cd $INIT_DIRECTORY
create_temp_liquibase_file $INIT_DIRECTORY liquibase.properties
copy_data_to_liquibaes_prop_file $INIT_DIRECTORY
$LQ --defaultsFile=liquibase-temp.properties tag $TAG
$LQ --defaultsFile=liquibase-temp.properties update

create_temp_liquibase_file $INIT_DIRECTORY auth.properties
copy_data_to_liquibaes_prop_file $INIT_DIRECTORY
$LQ --defaultsFile=liquibase-temp.properties tag $TAG
$LQ --defaultsFile=liquibase-temp.properties update

# run beskar scripts
BESKAR_DIRECTORY=$DIRECTORY/db/beskar
cd $BESKAR_DIRECTORY
create_temp_liquibase_file $BESKAR_DIRECTORY liquibase.properties
copy_data_to_liquibaes_prop_file $BESKAR_DIRECTORY
$LQ --defaultsFile=liquibase-temp.properties tag $TAG
$LQ --defaultsFile=liquibase-temp.properties update

echo "database initialised with schema 🔥"
