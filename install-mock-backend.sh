#!/bin/bash
# Install script for ESP RGB Mock Backend with Podman quadlets
set -e

# Variables
REPO_URL="https://github.com/pljakobs/esp_rgb_mock_backend.git"
BACKEND_DIR="/srv/esp_rgb_mock_backend"
QUADLET_DIR="$HOME/.config/containers/systemd"
NGINX_CONF_SRC="$(pwd)/nginx-mock.conf"
NGINX_CONF_DEST="/srv/nginx-mock.conf"

# Clone or update backend repo
if [ ! -d "$BACKEND_DIR/.git" ]; then
  echo "Cloning backend repo to $BACKEND_DIR..."
  git clone "$REPO_URL" "$BACKEND_DIR"
else
  echo "Updating backend repo in $BACKEND_DIR..."
  git -C "$BACKEND_DIR" pull
fi

# Copy quadlet files
mkdir -p "$QUADLET_DIR"
cp mock-backend.container "$QUADLET_DIR/"
cp nginx.container "$QUADLET_DIR/"

# Copy nginx config
sudo mkdir -p /srv
sudo cp "$NGINX_CONF_SRC" "$NGINX_CONF_DEST"

# Reload systemd user manager
systemctl --user daemon-reload

# Enable and start services
systemctl --user enable --now mock-backend
systemctl --user enable --now nginx

echo "Installation complete. Backend will be available on port 80 via nginx."
