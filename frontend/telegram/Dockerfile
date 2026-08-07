# ---- build stage ----
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && corepack prepare pnpm@10.25.0 --activate \
    && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- runtime stage: lightweight nginx ----
FROM nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
