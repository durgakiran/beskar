FROM golang:1.23.3-alpine

WORKDIR /app

# Install ca-certificates and curl
RUN apk add --no-cache ca-certificates curl

# Update the ca-certificates file
RUN update-ca-certificates

EXPOSE 8080

CMD go mod download && go build -o signalserver && ./signalserver
