#!/bin/sh
# release.sh v0.1.0: builds the four programs into dist/ and makes the GitHub release from them.
# INSTALL.md downloads them by these names.
set -e
v=${1:?usage: ./release.sh v0.1.0}
go vet ./... && go test ./...
rm -rf dist
for t in darwin/arm64 darwin/amd64 linux/amd64 linux/arm64; do
  GOOS=${t%/*} GOARCH=${t#*/} CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$v" -o "dist/verbally-${t%/*}-${t#*/}" .
done
gh release create "$v" dist/* --title "$v" --generate-notes
