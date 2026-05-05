FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY apps/monolith/package.json ./apps/monolith/
COPY libs/common/package.json ./libs/common/
COPY libs/config/package.json ./libs/config/
COPY libs/zod-validation/package.json ./libs/zod-validation/
COPY libs/database-core/package.json ./libs/database-core/
COPY libs/rmq/package.json ./libs/rmq/

RUN npm install --no-audit --no-fund

COPY apps/monolith ./apps/monolith
COPY libs ./libs

RUN npm run build:libs
RUN cd apps/monolith && npx nest build

# ---------------- Runtime ----------------

FROM node:22-alpine AS runtime

WORKDIR /app


COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/monolith/package.json ./apps/monolith/
COPY --from=builder /app/libs ./libs
COPY --from=builder /app/apps/monolith/dist ./apps/monolith/dist
COPY --from=builder /app/node_modules ./node_modules

WORKDIR /app/apps/monolith

CMD ["node", "dist/main.js"]
