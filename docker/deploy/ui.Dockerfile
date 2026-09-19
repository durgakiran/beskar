FROM node:22-alpine AS deps

WORKDIR /app
ENV NODE_OPTIONS=--dns-result-order=ipv4first

ARG NPM_TOKEN

COPY ui/package.json ui/package-lock.json ./

RUN test -n "$NPM_TOKEN"
RUN printf "registry=https://registry.npmjs.org/\n@durgakiran:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=%s\n" "$NPM_TOKEN" > .npmrc
RUN npm ci

FROM scratch AS local-editor-dist
COPY packages/editor/dist /dist

FROM scratch AS local-glideboard-dist
COPY packages/glideboard/dist /dist

FROM scratch AS local-glideline-dist
COPY packages/glideline/dist /dist

FROM scratch AS local-canvas-text-editor-dist
COPY packages/canvas-text-editor/dist /dist

FROM golang:1.23.3-alpine AS wasm-builder

WORKDIR /src/jbi
ENV GODEBUG=netdns=go

COPY jbi/go.mod jbi/go.sum ./
RUN go mod download

COPY jbi ./
RUN GOOS=js GOARCH=wasm go build -o /out/jbi.wasm .

FROM node:22-alpine AS builder-base

WORKDIR /app

ARG NEXT_PUBLIC_USER_SERVER_URL
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_IMAGE_SERVER_URL
ARG NEXT_PUBLIC_SIGNALING_URL
ARG NEXT_PUBLIC_HASURA_PROJECT_ENDPOINT
ARG NEXT_PUBLIC_PAGE_EVENTS_SSE
ARG NEXT_PUBLIC_PAGE_EVENTS_TRANSPORT_LOG
ARG NEXT_PUBLIC_EDITOR_PRESENCE

# Map NEXT_PUBLIC variables passed from docker-compose directly to VITE_
ENV VITE_USER_SERVER_URL=$NEXT_PUBLIC_USER_SERVER_URL
ENV VITE_API_URL=$NEXT_PUBLIC_API_URL
ENV VITE_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV VITE_IMAGE_SERVER_URL=$NEXT_PUBLIC_IMAGE_SERVER_URL
ENV VITE_SIGNALING_URL=$NEXT_PUBLIC_SIGNALING_URL
ENV VITE_HASURA_PROJECT_ENDPOINT=$NEXT_PUBLIC_HASURA_PROJECT_ENDPOINT
ENV VITE_PAGE_EVENTS_SSE=$NEXT_PUBLIC_PAGE_EVENTS_SSE
ENV VITE_PAGE_EVENTS_TRANSPORT_LOG=$NEXT_PUBLIC_PAGE_EVENTS_TRANSPORT_LOG
ENV VITE_EDITOR_PRESENCE=$NEXT_PUBLIC_EDITOR_PRESENCE

COPY --from=deps /app/node_modules ./node_modules
RUN mkdir -p /app/public
COPY ui ./
COPY --from=wasm-builder /out/jbi.wasm ./public/jbi.wasm

FROM builder-base AS builder

RUN npm run build:workers
RUN npm run build

FROM builder-base AS builder-local-packages
COPY --from=local-editor-dist /dist ./node_modules/@durgakiran/editor/dist
COPY --from=local-glideboard-dist /dist ./node_modules/@durgakiran/glideboard/dist
COPY --from=local-glideline-dist /dist ./node_modules/@durgakiran/glideline/dist
COPY --from=local-canvas-text-editor-dist /dist ./node_modules/@durgakiran/canvas-text-editor/dist
RUN npm run build:workers
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN npm install -g serve
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["serve", "-s", "dist", "-l", "3000"]

FROM node:22-alpine AS runner-local-packages
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN npm install -g serve
COPY --from=builder-local-packages /app/dist ./dist
EXPOSE 3000
CMD ["serve", "-s", "dist", "-l", "3000"]
