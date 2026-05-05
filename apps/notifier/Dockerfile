FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY apps/notifier/package.json ./apps/notifier/
COPY libs/common/package.json ./libs/common/
COPY libs/zod-validation/package.json ./libs/zod-validation/
COPY libs/database-core/package.json ./libs/database-core/
COPY libs/rmq/package.json ./libs/rmq/

RUN npm install --no-audit --no-fund

COPY apps/notifier ./apps/notifier
COPY libs ./libs

RUN npm run build:libs
RUN cd apps/notifier && npx prisma generate --schema=./prisma/schema.prisma
RUN cd apps/notifier && npx nest build

# ---------------- Runtime ----------------

FROM node:22-alpine AS runtime

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/notifier/package.json ./apps/notifier/
COPY --from=builder /app/libs ./libs
COPY --from=builder /app/apps/notifier/dist ./apps/notifier/dist
COPY --from=builder /app/apps/notifier/prisma ./apps/notifier/prisma
COPY --from=builder /app/node_modules ./node_modules

WORKDIR /app/apps/notifier

CMD ["node", "dist/main.js"]
