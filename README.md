### Requirements
- Node verison : 18.19
- java: 17
- gradle:
- golang
- postgres: 14+
- docker (4.28.0)
- docker compose
- liquibase
- task-go

### Local development
This app relies on some core services as primary backend
- postgres as main database
- hasura graphql server
- keycloak server for authentication and authorization

There are two docker files app.yml and db.yml in docker folder to run these servers.
As a first step you need to run shell file (`db.sh`) from project root first. This would create postgres database container and spins up a build container from where liquibase changesets gets executed against database. After completing the database setup, you need to run `app.sh` in `docker/app` directory to spin up app servers, this would create keycloak container and sets up all the basic configuration including creating realms and clients and adding github as identity provider for authentication. However, this process relies on adding GITHUB tokens in env file. Here are the rough steps

- Create IDP token in github using this guid  https://medium.com/keycloak/github-as-identity-provider-in-keyclaok-dca95a9d80ca
- run `./docker/database/db.sh`
- create .env.local in the `./docker/app` directory. copy contents from .env.example
- Add github token and secret in .env.local
- run `./docker/app/app.sh` (make sure you are running only when database setup is complete)

Tip: try running `./docker/app/app.sh` multiple times to complete the app setup.

Notes:
powershell command to attach local volume `docker run -d --name devtest -v ${PWD}:/app  build-db:latest`

### Building wasm
command: `GOOS=js GOARCH=wasm go build -o ./jbi.wasm`

copy to public folder: `cp ./jbi.wasm ../ui/public`

### Generating graphl metada (hasura)
Generate hasura graphql meta: `hasura metadata export --endpoint http://localhost:8080 --admin-secret <secret-value>`

## FAQ:
1. How do I know my database setup is done?

    you should have docker container named `devbuild` and the last should be `database initalised with schema 🔥`

2. How do I install docker?

    just follow the installation guide here: https://docs.docker.com/engine/install/
