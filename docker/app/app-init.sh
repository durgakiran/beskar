#!/bin/bash


DIRECTORY=$PWD
WD=$DIRECTORY/docker/app
KQD=keycloakbin
IMAGE=local-build-db:latest
CONTAINER=devbuild

# install keycloak admin cli
echo "running from 📂 $DIRECTORY"
echo "setting up keycloak configuration 🚧"

if [ ! -d $WD/$KQD ]
then
    echo "keycloak binaries does not exist, downloading ... ⚙️"
    mkdir $WD/$KQD
    curl -kLSs https://github.com/keycloak/keycloak/releases/download/24.0.2/keycloak-24.0.2.zip -o $WD/$KQD/keycloak.zip
    unzip $WD/$KQD/keycloak.zip -d $WD/$KQD
fi

KQ=$WD/$KQD/keycloak-24.0.2/bin/kcadm.sh
REALM=devbeskarrealm
CLIENT=besarappclient

echo create a realm
$KQ get realms --no-config --server http://shield:8080 --realm master --user admin --password admin | jq '.[] | { name: .realm }' | grep $REALM | grep -q . \
    && echo realm found 😁 \
    || $KQ create realms --no-config -s realm=$REALM -s enabled=true -o --server http://shield:8080 --realm master --user admin --password admin


echo create a client in realm
$KQ get clients -r $REALM  --no-config --server http://shield:8080 --realm master --user admin --password admin | jq '.[] | { name: .clientId }' | grep $CLIENT | grep -q . \
    && echo client found 😁 \
    || $KQ create clients --no-config --server http://shield:8080  --realm master --user admin --password admin -r $REALM -s clientId=$CLIENT -s enabled=true -s 'redirectUris=["http://localhost:8080/*", "http://localhost:3000/*"]' -s 'webOrigins=["http://localhost:8080", "http://localhost:3000"]' -s publicClient=true

echo create a IDP with github
$KQ get identity-provider/instances -r $REALM --fields alias,providerId,enabled --no-config --server http://shield:8080  --realm master --user admin --password admin | jq '.[] | { name: .alias }' | grep github | grep -q . \
    && echo IDP found 😁 \
    || $KQ create identity-provider/instances --no-config --server http://shield:8080  --realm master --user admin --password admin -r $REALM -s alias=github -s providerId=github -s enabled=true  -s 'config.useJwksUrl="true"' -s config.clientId=$GITHUB_CLIENT_ID -s config.clientSecret=$GITHUB_CLIENT_SECRET


# update client with redirect uris
$KQ update clients --no-config --server http://shield:8080  --realm master --user admin --password admin 

# check if postgres is up and healthy
# until pg_isready -h localhost -p 5432
# do
#     echo "waiting for postgres container to be ready... 😫"
#     sleep 1
# done

until curl -XGET --output /dev/null --silent --head --fail http://graphql-engine:8080/healthz?strict=false; do
    echo 'waiting for graphql server to be ready... 😫'
    sleep 5
done

echo 'graphql engine is ready... 😁'

# install hasura cli
curl -L https://github.com/hasura/graphql-engine/raw/stable/cli/get.sh | bash

sleep 5

# apply hasura metadata
hasura metadata apply --admin-secret "$HASURA_GRAPHQL_ADMIN_SECRET" --endpoint http://graphql-engine:8080

echo 'graphql server setup is ready 🔥'
