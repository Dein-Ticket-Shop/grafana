#!/usr/bin/env bash
set -e

# `make build-docker-full` always tags its output grafana/grafana-oss:dev (see
# TAG_SUFFIX/build-docker-full in the Makefile) - it does not read VERSION.
SRC_IMG_NAME="grafana-oss:dev"
VERSION="$(node -p "require('./package.json').version")"
DEST_IMG_NAME="grafana-oss:$VERSION"

echo "🕓 Building Docker image..."
make build-docker-full

# Tag accordingly to upload to rg.fr-par.scw.cloud/dein-ticket-shop
echo "🕓 Tagging Docker image as $DEST_IMG_NAME..."
docker tag grafana/$SRC_IMG_NAME rg.fr-par.scw.cloud/dein-ticket-shop/$DEST_IMG_NAME

# Push to the registry
echo "🕓 Pushing Docker image to registry..."
docker push rg.fr-par.scw.cloud/dein-ticket-shop/$DEST_IMG_NAME

echo "✅ Docker image successfully built and pushed to rg.fr-par.scw.cloud/dein-ticket-shop/$DEST_IMG_NAME"