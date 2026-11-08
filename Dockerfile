# ==============================================================================
# Multi-stage Dockerfile cho Flash Sale Distributed System
# ==============================================================================

# STAGE 1: Build source code & dependencies
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Cài đặt OpenSSL cho Prisma
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/

# Cài đặt đầy đủ dependencies (bao gồm devDependencies để build)
RUN npm ci

# Generate Prisma Client
RUN npx prisma generate

# Copy toàn bộ mã nguồn
COPY . .

# Biên dịch TypeScript sang JavaScript trong dist/
RUN npm run build

# ==============================================================================
# STAGE 2: Production Runner Image
# ==============================================================================
FROM node:20-alpine AS runner

WORKDIR /usr/src/app

# Cài đặt OpenSSL cho Prisma Runtime & curl cho healthcheck
RUN apk add --no-cache openssl curl

ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma/

# Chỉ cài đặt production dependencies
RUN npm ci --omit=dev

# Generate Prisma Client cho production runtime
RUN npx prisma generate

# Copy mã nguồn đã build từ STAGE 1
COPY --from=builder /usr/src/app/dist ./dist

EXPOSE 3000 3001

CMD ["node", "dist/app.js"]
