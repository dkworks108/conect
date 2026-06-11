#!/bin/sh
set -eu

echo "=========================================="
echo "         CONNECT PWA - SERVER START       "
echo "=========================================="

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is not installed. Please install Node.js 18 or newer."
    exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
    echo "npm is not installed. Please install npm 9 or newer."
    exit 1
fi

if [ ! -d node_modules ]; then
    echo "Installing dependencies..."
    npm install
fi

echo "Starting server..."
npm start
