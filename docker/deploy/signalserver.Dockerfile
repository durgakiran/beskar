FROM golang:1.23.3-alpine AS builder

WORKDIR /src/signalserver

COPY signalserver/go.mod signalserver/go.sum ./
RUN go mod download

COPY signalserver ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/signalserver .

FROM alpine:3.20

RUN apk add --no-cache ca-certificates

WORKDIR /app
COPY --from=builder /out/signalserver /usr/local/bin/signalserver

EXPOSE 8080

CMD ["signalserver"]
