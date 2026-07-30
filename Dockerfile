# Full bookworm, not -slim, on purpose. The Prisma query engine is a native
# module that dlopen()s libssl.so.3, and -slim does not ship libssl3 — the build
# log shows apt installing it as a NEW package. This image is built by Kaniko
# rather than a Docker daemon, and that apt layer was not surviving into the
# final image, so every query died with:
#   Unable to require(.../libquery_engine-debian-openssl-3.0.x.so.node)
#   Prisma cannot find the required `libssl` system library in your system
# The full image carries libssl3 in the base rootfs, which Kaniko unpacks
# directly instead of reconstructing from a snapshot.
FROM node:22-bookworm

RUN apt-get update -y && \
    apt-get install -y openssl libssl3 ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

# Fail the build here rather than at runtime. Both of these were present when
# their layer ran and absent from the running container, so assert they survived
# to the last layer — a failed build is far cheaper to diagnose than a container
# that starts fine and then rejects every query.
RUN ldconfig -p | grep -q 'libssl.so.3' \
    && ls node_modules/.prisma/client/libquery_engine-*.so.node \
    || (echo "FATAL: libssl.so.3 or the Prisma query engine is missing from this image" >&2; exit 1)

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

CMD ["npm", "start"]
