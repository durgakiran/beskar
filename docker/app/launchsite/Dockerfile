FROM node:22-alpine AS deps

WORKDIR /app
ENV NODE_OPTIONS=--dns-result-order=ipv4first

COPY landing-site/package.json landing-site/package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY landing-site ./
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app ./

EXPOSE 3001

CMD ["npm", "run", "start"]
