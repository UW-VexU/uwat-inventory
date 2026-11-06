FROM node:24-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY packages/shared packages/shared
COPY backend/package.json backend/package-lock.json backend/
WORKDIR /app/backend
RUN npm ci --omit=dev
COPY backend/prisma prisma
RUN npx prisma generate
COPY backend/src src
ENV NODE_ENV=production
EXPOSE 2211
CMD ["sh", "-c", "npx prisma migrate deploy && exec npx tsx src/index.ts"]
