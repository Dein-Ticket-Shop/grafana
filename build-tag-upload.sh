#!/usr/bin/env bash
set -e

# Build Docker image
IMG_NAME="grafana-oss:beta"

echo "🕓 Building Docker image..."
make build-docker-full

# Tag accordingly to upload to rg.fr-par.scw.cloud/dein-ticket-shop
echo "🕓 Tagging Docker image..."
docker tag grafana/$IMG_NAME rg.fr-par.scw.cloud/dein-ticket-shop/$IMG_NAME

# Push to the registry
echo "🕓 Pushing Docker image to registry..."
docker push rg.fr-par.scw.cloud/dein-ticket-shop/$IMG_NAME

echo "✅ Docker image successfully built and pushed to rg.fr-par.scw.cloud/dein-ticket-shop/$IMG_NAME"