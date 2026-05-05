FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY apps/users/package.json ./apps/users/
COPY libs/common/package.json ./libs/common/
COPY libs/zod-validation/package.json ./libs/zod-validation/
COPY libs/database-core/package.json ./libs/database-core/
COPY libs/rmq/package.json ./libs/rmq/
COPY libs/metrics/package.json ./libs/metrics/

RUN npm install --no-audit --no-fund

COPY apps/users ./apps/users
COPY libs ./libs

RUN npm run build:libs
RUN cd apps/users && npx prisma generate --schema=./prisma/schema.prisma
RUN cd apps/users && npx nest build

# ---------------- Runtime ----------------

FROM node:22-alpine AS runtime

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/users/package.json ./apps/users/
COPY --from=builder /app/libs ./libs
COPY --from=builder /app/apps/users/dist ./apps/users/dist
COPY --from=builder /app/apps/users/prisma ./apps/users/prisma
COPY --from=builder /app/node_modules ./node_modules

WORKDIR /app/apps/users

CMD ["node", "dist/main.js"]
