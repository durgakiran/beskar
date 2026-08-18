our application runs in docker compose.

### To apply new dev env variables
```
./docker/scripts/render-configs.sh --env docker/env/dev.env
```

### To validate new env variables
```
./docker/scripts/validate-config.sh --env docker/env/dev.env
```

### To start the whole application servers:
```
./docker/scripts/deploy.sh --env docker/env/dev.env
```

### To start specific application servers
```
docker compose -f docker/.generated/compose.yml -p beskar-dev up -d --build --force-recreate --no-deps ui
```


### To test the ui changes
1. Do the changes in `ui` folder
2. apply any env changes `./docker/scripts/render-configs.sh --env docker/env/dev.env ` and validate them
3. clean restart the ui container `docker compose -f docker/.generated/compose.yml -p beskar-dev up -d --build --force-recreate --no-deps ui`

### To test the server changes
1. Do the changes in `server` folder
2. apply any env changes `./docker/scripts/render-configs.sh --env docker/env/dev.env ` and validate them
3. clean restart the ui container `docker compose -f docker/.generated/compose.yml -p beskar-dev up -d --build --force-recreate --no-deps server`

### To verify changes on browser
1. visit https://app.durgakiran.com
2. login with user: beskaruser1@gmail.com and password: Password@1
