#!/bin/bash

# Manual escape hatch. The `:latest` image is normally built and pushed by the
# Backend Deployment workflow on every merge to main; use this for the `:testing`
# image, or when Actions is unavailable.

cd "$(dirname "$0")/.."

if [ "$1" == "test" ]; then
  IMAGE_TAG="maelstromeous/albion-mapper:testing-latest"
  BUILD_MSG="Docker test build completed"
else
  IMAGE_TAG="maelstromeous/albion-mapper:latest"
  BUILD_MSG="Docker build completed"
fi

if [ "$(uname)" == "Darwin" ]; then
  docker buildx build --platform linux/amd64 . -f provisioning/Dockerfile -t $IMAGE_TAG --push
else
  docker build --platform linux/amd64 . -f provisioning/Dockerfile -t $IMAGE_TAG
  docker push $IMAGE_TAG
fi
echo "$BUILD_MSG"
