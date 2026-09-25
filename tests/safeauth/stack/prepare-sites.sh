#!/usr/bin/env bash
# Builds the safeauth variants used by the local browser review and composes them:
#   $1 = a copy of a built site (e.g. WorklazyTools dist) to receive /safeauth/ (recomposed)
# Outputs under .safeauth-stack/: dist-safeauth-local (base /safeauth/, loopback stack),
# dist-safeauth-root (base /, second gateway), site-unconfigured (production build, no config).
set -euo pipefail
cd "$(dirname "$0")/../../.."
SITE="${1:?usage: prepare-sites.sh <site-copy-dir>}"
SHA="$(git rev-parse HEAD)"
SAFEAUTH_OUT_DIR=.safeauth-stack/dist-safeauth-local SAFEAUTH_PUBLIC_SUPABASE_URL=http://127.0.0.1:54400 \
  SAFEAUTH_PUBLIC_SITE_URL=http://127.0.0.1:8480/safeauth/ npx vite build --mode localtest --config apps/safeauth/vite.config.ts --logLevel warn
SAFEAUTH_BASE=/ SAFEAUTH_OUT_DIR=.safeauth-stack/dist-safeauth-root SAFEAUTH_PUBLIC_SUPABASE_URL=http://127.0.0.1:54401 \
  SAFEAUTH_PUBLIC_SITE_URL=http://127.0.0.1:8481/ npx vite build --mode localtest --config apps/safeauth/vite.config.ts --logLevel warn
npx vite build --config apps/safeauth/vite.config.ts --logLevel warn   # production, unconfigured -> dist-safeauth
rm -rf "$SITE/safeauth"
node scripts/safeauth/compose-into-site.mjs --site-dist "$SITE" --auth-dist .safeauth-stack/dist-safeauth-local \
  --source-sha "$SHA" --expect-supabase http://127.0.0.1:54400 --site-origin http://127.0.0.1:8480 --report .safeauth-stack/compose-local.json
rm -rf .safeauth-stack/site-unconfigured && mkdir -p .safeauth-stack/site-unconfigured
printf '<!doctype html><title>root</title>' > .safeauth-stack/site-unconfigured/index.html
printf '<!doctype html><title>404</title>' > .safeauth-stack/site-unconfigured/404.html
node scripts/safeauth/compose-into-site.mjs --site-dist .safeauth-stack/site-unconfigured --auth-dist dist-safeauth \
  --source-sha "$SHA" --report .safeauth-stack/compose-unconfigured.json
