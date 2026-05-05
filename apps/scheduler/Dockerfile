FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY apps/scheduler/package.json ./apps/scheduler/
COPY libs/common/package.json ./libs/common/
COPY libs/zod-validation/package.json ./libs/zod-validation/
COPY libs/database-core/package.json ./libs/database-core/
COPY libs/rmq/package.json ./libs/rmq/
COPY libs/metrics/package.json ./libs/metrics/

RUN npm install --no-audit --no-fund

COPY apps/scheduler ./apps/scheduler
COPY libs ./libs

RUN npm run build:libs
RUN cd apps/scheduler && npx nest build

# ---------------- Runtime ----------------

FROM node:22-alpine AS runtime

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/scheduler/package.json ./apps/scheduler/
COPY --from=builder /app/libs ./libs
COPY --from=builder /app/apps/scheduler/dist ./apps/scheduler/dist
COPY --from=builder /app/node_modules ./node_modules

WORKDIR /app/apps/scheduler

CMD ["node", "dist/main.js"]
