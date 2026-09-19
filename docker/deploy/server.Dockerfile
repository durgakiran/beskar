FROM golang:1.23.3-alpine AS builder

WORKDIR /src/server
ENV GODEBUG=netdns=go

COPY server/go.mod server/go.sum ./
RUN go mod download

COPY server ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/server .

FROM node:22-alpine AS whiteboard-runtime
WORKDIR /runtime
COPY server/whiteboard-runtime/package*.json ./
RUN npm ci --omit=dev
COPY server/whiteboard-runtime/*.mjs ./

FROM alpine:3.20

RUN apk add --no-cache ca-certificates nodejs

WORKDIR /app
COPY --from=whiteboard-runtime /runtime /app/whiteboard-runtime
COPY --from=builder /out/server /usr/local/bin/server

EXPOSE 9095

CMD ["server"]
