FROM golang:1.23.3-alpine

WORKDIR /app

EXPOSE 9095 40000

RUN go install github.com/go-delve/delve/cmd/dlv@latest

CMD go mod download && go build -o server && dlv --listen=:40000 --headless=true --api-version=2 --accept-multiclient exec ./server
