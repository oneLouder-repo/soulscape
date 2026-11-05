# soulscape in a container: no dependencies to install, just Node and the code.
#   docker build -t soulscape . && docker run -p 8080:8080 -v soulscape-data:/data -e SUPER_ADMIN_PASSWORD=... soulscape
# Fly.io builds this with `fly deploy` (see fly.toml and DEPLOY.md).
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    TRUST_PROXY=true

WORKDIR /app
COPY . .
RUN mkdir -p /data && chown node:node /data

EXPOSE 8080
VOLUME /data

# A host's disk is mounted over /data as root; hand it to the unprivileged
# `node` user, then run as that user.
CMD ["sh", "-c", "chown -R node:node /data && exec setpriv --reuid=node --regid=node --init-groups node --disable-warning=ExperimentalWarning server.js"]
