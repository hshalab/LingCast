# ---- build stage ----
FROM golang:1.26-alpine AS builder

WORKDIR /src

ARG SERVICE=api-admin

COPY go.mod go.sum ./
ENV GOPROXY=https://goproxy.cn,direct
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/${SERVICE}

# ---- runtime stage ----
FROM alpine:latest

RUN apk add --no-cache ca-certificates tzdata

COPY --from=builder /out/api /usr/local/bin/api

EXPOSE 8081
ENTRYPOINT ["api"]
