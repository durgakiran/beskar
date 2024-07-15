#!/bin/bash

DIRECTORY=$PWD
WD=$DIRECTORY/docker/database
IMAGE=local-build-db:latest
CONTAINER=devbuild

# bring up databases
docker compose -f $WD/db.yml -p beskar-db up -d

# building docker file
docker build -t $IMAGE $WD

echo $DIRECTORY

# stop and remove the container if already exists
docker stop $CONTAINER && docker rm -fv $CONTAINER

sleep 5

# run the container
# there is an issue while attaching volume in windows, so needed to add additional // at the start
# https://stackoverflow.com/questions/35315996/how-do-i-mount-a-docker-volume-while-using-a-windows-host
# TODO: need to check if this works on linux/mac
docker run -d --name $CONTAINER -v //$DIRECTORY:/app --network custom_local_network  $IMAGE  -it
