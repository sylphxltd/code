#!/usr/bin/env bash

# Quick start script for documentation development
# Usage: ./dev.sh [command]
#   No args: Start dev server
#   build: Build for production
#   preview: Preview production build

set -e

cd "$(dirname "$0")"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  if command -v bun >/dev/null 2>&1; then
    bun install
  else
    npm install
  fi
fi

# Run command
case "${1:-dev}" in
  dev)
    echo "🚀 Starting development server..."
    echo "📖 Documentation will be available at http://localhost:5173"
    echo ""
    if command -v bun >/dev/null 2>&1; then
      bun dev
    else
      npm run dev
    fi
    ;;
  build)
    echo "🏗️  Building documentation..."
    if command -v bun >/dev/null 2>&1; then
      bun build
    else
      npm run build
    fi
    echo "✅ Build complete! Output: .vitepress/dist/"
    ;;
  preview)
    echo "👀 Previewing production build..."
    if command -v bun >/dev/null 2>&1; then
      bun preview
    else
      npm run preview
    fi
    ;;
  clean)
    echo "🧹 Cleaning build artifacts..."
    rm -rf .vitepress/dist .vitepress/cache node_modules
    echo "✅ Clean complete!"
    ;;
  *)
    echo "Usage: $0 [dev|build|preview|clean]"
    exit 1
    ;;
esac
