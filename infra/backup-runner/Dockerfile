# Gestcopy backup runner — Coolify-hosted scheduled jobs.
# Does NOT run backups on start; Coolify Scheduled Tasks invoke /app/scripts/*.sh
#
# Base: Alpine stable (pinned). Includes rclone + bash tooling for Files backup,
# and PostgreSQL 17 client for upcoming B1.3 pg_dump scaffolding.

FROM alpine:3.21

RUN apk add --no-cache \
      bash \
      ca-certificates \
      curl \
      flock \
      jq \
      rclone \
      postgresql17-client \
      tzdata \
    && update-ca-certificates \
    && adduser -D -H -u 10001 -s /sbin/nologin backup

WORKDIR /app

COPY scripts/ /app/scripts/
RUN chmod 0755 /app/scripts/*.sh \
    && chown -R backup:backup /app

USER backup

# Stay alive so Coolify can exec Scheduled Tasks inside this container.
# Backups are never started by ENTRYPOINT/CMD.
CMD ["sleep", "infinity"]
