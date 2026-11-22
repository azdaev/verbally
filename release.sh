#!/bin/sh
# release.sh v0.1.0: builds the four programs into dist/ and makes the GitHub release from them.
# INSTALL.md downloads them by these names.
set -e
v=${1:?usage: ./release.sh v0.1.0}
npm ci
npm run build
npm test
go vet ./... && go test ./...
rm -rf dist
for t in darwin/arm64 darwin/amd64 linux/amd64 linux/arm64; do
  GOOS=${t%/*} GOARCH=${t#*/} CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$v" -o "dist/verbally-${t%/*}-${t#*/}" .
done
# `verbally update` checks each download against this list before it runs the new program.
(cd dist && sha256sum verbally-* > SHA256SUMS 2>/dev/null || shasum -a 256 verbally-* > SHA256SUMS)
gh release create "$v" dist/* --title "$v" --generate-notes
