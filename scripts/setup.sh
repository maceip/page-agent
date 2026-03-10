#!/usr/bin/env bash
# One-command project setup for new contributors.
# Usage: ./scripts/setup.sh
set -euo pipefail

echo "==> Checking Node.js version..."
NODE_VERSION=$(node -v 2>/dev/null || true)
if [ -z "$NODE_VERSION" ]; then
  echo "Error: Node.js is not installed. Install Node.js >= 20."
  echo "  https://nodejs.org or use nvm/fnm"
  exit 1
fi

NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Error: Node.js $NODE_VERSION found, but >= 20 is required."
  exit 1
fi
echo "    Node.js $NODE_VERSION OK"

echo "==> Installing dependencies..."
npm ci

echo "==> Building libraries..."
npm run build:libs

echo "==> Setting up .env (if not present)..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "    Created .env from .env.example — edit it to add your LLM API key."
else
  echo "    .env already exists, skipping."
fi

echo ""
echo "Done! You're ready to go. Common commands:"
echo ""
echo "  npm start          Start the website dev server"
echo "  npm test           Run tests"
echo "  npm run dev:ext    Develop the browser extension"
echo "  npm run dev:demo   Serve bookmarklet for testing on other sites"
echo ""
