#!/bin/sh
set -e
cd /app
# Pull latest code and install dependencies
git pull || true
npm install
npm start
