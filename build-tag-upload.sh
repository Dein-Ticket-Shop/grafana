#!/usr/bin/env bash

# Build Docker image
# Resulting Image is grafana/grafana-oss:dev
echo "🕓 Building Docker image..."
# make build-docker-full

# Tag accordingly to upload to rg.fr-par.scw.cloud/dein-ticket-shop
echo "🕓 Tagging Docker image..."
docker tag grafana/grafana-oss:dev rg.fr-par.scw.cloud/dein-ticket-shop/grafana-oss:dev

# Push to the registry
echo "🕓 Pushing Docker image to registry..."
docker push rg.fr-par.scw.cloud/dein-ticket-shop/grafana-oss:dev

echo "✅ Docker image successfully built and pushed to rg.fr-par.scw.cloud/dein-ticket-shop/grafana-oss:dev"