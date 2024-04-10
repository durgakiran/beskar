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
CONFIG="--no-config --server http://shield:8080  --realm master --user admin --password admin"

echo create a realm
$KQ get realms $CONFIG | jq '.[] | { name: .realm }' | grep $REALM | grep -q . \
    && echo realm found 😁 \
    || $KQ create realms -s realm=$REALM -s enabled=true -o $CONFIG


echo create a client in realm
$KQ get clients -r $REALM  $CONFIG | jq '.[] | { name: .clientId }' | grep $CLIENT | grep -q . \
    && echo client found 😁 \
    || $KQ create clients $CONFIG -r $REALM -s clientId=$CLIENT -s enabled=true -s 'redirectUris=["http://localhost:8080/*", "http://localhost:3000/*"]' -s 'webOrigins=["http://localhost:8080", "http://localhost:3000"]' -s publicClient=true -s fullScopeAllowed=true

echo create a IDP with github
$KQ get identity-provider/instances -r $REALM --fields alias,providerId,enabled $CONFIG | jq '.[] | { name: .alias }' | grep github | grep -q . \
    && echo IDP found 😁 \
    || $KQ create identity-provider/instances $CONFIG -r $REALM -s alias=github -s providerId=github -s enabled=true  -s 'config.useJwksUrl="true"' -s config.clientId=$GITHUB_CLIENT_ID -s config.clientSecret=$GITHUB_CLIENT_SECRET


echo creating default user role
$KQ get roles -r $REALM --fields name $CONFIG | jq '.[] | { name: .name }' | grep user | grep -q . \
    && echo role found 😁 \
    || $KQ create roles -r $REALM  $CONFIG -s name=user -s 'description=Regular user with a limited set of permissions'


echo add protocol mappers
mappers=`$KQ get clients -r $REALM $CONFIG | jq '[.[] | { id: .id, clientId: .clientId, protocolMappers: .protocolMappers }]'`
echo $mappers
mapper_names=$(jq -n "$mappers" | jq '.[] | select(.clientId == "besarappclient") | .protocolMappers // []' | jq '[.[] | .name]')
id=$(jq -n "$mappers" | jq ' .[] | select(.clientId == "besarappclient") | .id' | sed 's/"//g')
echo "client id $id"

value_exists() {
    local value=$1
    for item in "${mapper_names[@]}"; do
        if [[ "$item" == "$value" ]]; then
            return 0  # Value found
        fi
    done
    return 1  # Value not found
}


DEFAULT_PAYLOAD="-s protocol=openid-connect -s consentRequired=false -s config.\"userinfo.token.claim\"=true -s config.\"id.token.claim\"=true -s config.\"access.token.claim\"=true -s config.\"introspection.token.claim\"=true -s config.\"jsonType.label\"=String"
USER_ID_MAPPER_VALUE=x-hasura-user-id
USER_ID_MAPPER="-s name=$USER_ID_MAPPER_VALUE"
USER_ID_PROTOCOL_MAPPER="-s protocolMapper=oidc-usermodel-property-mapper"
USER_ID_CLAIM_NAME="-s config.\"claim.name\"=https://hasura\\.io/jwt/claims.x-hasura-user-id"
USER_ID_USER_ATTRIBUTE="-s config.\"user.attribute\"=id"

echo "adding $USER_ID_MAPPER_VALUE"
if value_exists "$USER_ID_MAPPER_VALUE"; then
    echo "$USER_ID_MAPPER_VALUE exists in the array."
else
    echo "$USER_ID_MAPPER_VALUE does not exist in the array."
    PAYLOAD="$USER_ID_MAPPER $USER_ID_PROTOCOL_MAPPER $DEFAULT_PAYLOAD $USER_ID_CLAIM_NAME $USER_ID_USER_ATTRIBUTE"
    echo "$KQ create clients/$id/protocol-mappers/models -r $REALM $CONFIG $PAYLOAD"
    $KQ create clients/$id/protocol-mappers/models -r $REALM $CONFIG $PAYLOAD
fi

ROLES_MAPPER_VALUE=x-hasura-allowed-roles
ROLES_MAPPER="-s name=$ROLES_MAPPER_VALUE"
ROLES_PROTOCOL_MAPPER="-s protocolMapper=oidc-usermodel-realm-role-mapper"
ROLES_CLAIM_NAME="-s config.\"claim.name\"=https://hasura\\.io/jwt/claims.x-hasura-allowed-roles"
ROLES_USER_ATTRIBUTE="-s config.\"multivalued\"=true"

echo "adding $ROLES_MAPPER_VALUE"
if value_exists "$ROLES_MAPPER_VALUE"; then
    echo "$ROLES_MAPPER_VALUE exists in the array."
else
    echo "$ROLES_MAPPER_VALUE does not exist in the array."
    PAYLOAD="$ROLES_MAPPER $ROLES_PROTOCOL_MAPPER $DEFAULT_PAYLOAD $ROLES_CLAIM_NAME $ROLES_USER_ATTRIBUTE"
    $KQ create clients/$id/protocol-mappers/models -r $REALM $CONFIG $PAYLOAD
fi

DEFAULT_MAPPER_VALUE=x-hasura-default-role
DEFAULT_MAPPER="-s name=$DEFAULT_MAPPER_VALUE"
DEFAULT_PROTOCOL_MAPPER="-s protocolMapper=oidc-hardcoded-claim-mapper"
DEFAULT_CLAIM_NAME="-s config.\"claim.name\"=https://hasura\\.io/jwt/claims.x-hasura-default-role"
DEFAULT_USER_ATTRIBUTE="-s config.\"claim.value\"=user"
DEFAULT_TOKEN_RESONSE="-s config.\"access.tokenResponse.claim\"=false"

echo "adding $DEFAULT_MAPPER_VALUE"
if value_exists "$DEFAULT_MAPPER_VALUE"; then
    echo "$DEFAULT_MAPPER_VALUE exists in the array."
else
    echo "$DEFAULT_MAPPER_VALUE does not exist in the array."
    PAYLOAD="$DEFAULT_MAPPER $DEFAULT_PROTOCOL_MAPPER $DEFAULT_PAYLOAD $DEFAULT_CLAIM_NAME $DEFAULT_USER_ATTRIBUTE $DEFAULT_TOKEN_RESONSE"
    $KQ create clients/$id/protocol-mappers/models -r $REALM $CONFIG $PAYLOAD
fi


until curl -XGET --output /dev/null --silent --head --fail http://graphql-engine:8080/healthz?strict=false; do
    echo 'waiting for graphql server to be ready... 😫'
    sleep 5
done

echo 'graphql engine is ready... 😁'

# install hasura cli
curl -L https://github.com/hasura/graphql-engine/raw/stable/cli/get.sh | bash

sleep 5


echo $HASURA_GRAPHQL_ADMIN_SECRET
# apply hasura metadata
hasura metadata apply --admin-secret "$HASURA_GRAPHQL_ADMIN_SECRET" --endpoint http://graphql-engine:8080

echo 'graphql server setup is ready 🔥'
