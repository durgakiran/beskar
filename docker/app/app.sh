#!/bin/bash

echo "bringing up app now 🚧"

DIRECTORY=$PWD
WD=$DIRECTORY/docker/app
KQD=keycloakbin
IMAGE=local-build-app:latest
CONTAINER=devappbuild

# install keycloak admin cli
echo "running from 📂 $DIRECTORY"

# bring up app servers
docker compose -f $WD/app.yml --env-file $WD/.env -p beskar-app up -d


# building docker file
docker build -t $IMAGE $WD


# stop and remove the container if already exists
docker stop $CONTAINER && docker rm -fv $CONTAINER

sleep 5

# run the container
# there is an issue while attaching volume in windows, so needed to add additional // at the start
# https://stackoverflow.com/questions/35315996/how-do-i-mount-a-docker-volume-while-using-a-windows-host
# TODO: need to check if this works on linux/mac
docker run -d --name $CONTAINER -v //$DIRECTORY:/app --env-file $WD/.env --network custom_local_network  $IMAGE  
