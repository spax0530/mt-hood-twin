#!/usr/bin/env bash
# Builds the site and publishes dist/ to the gh-pages branch, which GitHub Pages serves.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
remote=$(git remote get-url origin)
tmp=$(mktemp -d)
cp -r dist/. "$tmp"
touch "$tmp/.nojekyll"
git -C "$tmp" init -q -b gh-pages
git -C "$tmp" add -A
git -C "$tmp" -c user.name="${GIT_AUTHOR_NAME:-deploy}" -c user.email="${GIT_AUTHOR_EMAIL:-deploy@users.noreply.github.com}" commit -qm "Deploy $(git rev-parse --short HEAD)"
git -C "$tmp" push -f "$remote" gh-pages
rm -rf "$tmp"
