# ---- build stage ----
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && corepack prepare pnpm@10.25.0 --activate \
    && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- runtime stage (standalone server) ----
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# 拷贝完成后再移交属主：node 需在 /app 下有写权限（Next 运行时可能创建
# .next/cache 等目录）；COPY 始终以 root 写入，因此顺序必须在 COPY 之后。
RUN chown -R node:node /app
USER node

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
