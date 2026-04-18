FROM node:22-alpine AS deps

WORKDIR /app
ENV NODE_OPTIONS=--dns-result-order=ipv4first

ARG NPM_TOKEN

COPY ui/package.json ui/package-lock.json ./

RUN test -n "$NPM_TOKEN"
RUN printf "registry=https://registry.npmjs.org/\n@durgakiran:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=%s\n" "$NPM_TOKEN" > .npmrc
RUN npm ci

FROM golang:1.23.3-alpine AS wasm-builder

WORKDIR /src/jbi
ENV GODEBUG=netdns=go

COPY jbi/go.mod jbi/go.sum ./
RUN go mod download

COPY jbi ./
RUN GOOS=js GOARCH=wasm go build -o /out/jbi.wasm .

FROM node:22-alpine AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

ARG NEXTAUTH_URL
ARG NEXTAUTH_URL_INTERNAL
ARG NEXTAUTH_SECRET
ARG NEXT_PUBLIC_USER_SERVER_URL
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_IMAGE_SERVER_URL
ARG NEXT_PUBLIC_SIGNALING_URL
ARG NEXT_PUBLIC_HASURA_PROJECT_ENDPOINT

ENV NEXTAUTH_URL=$NEXTAUTH_URL
ENV NEXTAUTH_URL_INTERNAL=$NEXTAUTH_URL_INTERNAL
ENV NEXTAUTH_SECRET=$NEXTAUTH_SECRET
ENV NEXT_PUBLIC_USER_SERVER_URL=$NEXT_PUBLIC_USER_SERVER_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_IMAGE_SERVER_URL=$NEXT_PUBLIC_IMAGE_SERVER_URL
ENV NEXT_PUBLIC_SIGNALING_URL=$NEXT_PUBLIC_SIGNALING_URL
ENV NEXT_PUBLIC_HASURA_PROJECT_ENDPOINT=$NEXT_PUBLIC_HASURA_PROJECT_ENDPOINT

COPY --from=deps /app/node_modules ./node_modules
RUN mkdir -p /app/public
COPY ui ./
COPY --from=wasm-builder /out/jbi.wasm ./public/jbi.wasm
RUN npm run build:workers
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
