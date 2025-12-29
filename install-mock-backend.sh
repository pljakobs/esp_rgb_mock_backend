#!/bin/bash
# System-level install script for ESP RGB Mock Backend with Podman quadlets
set -e

# Must be run as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root."
  exit 1
fi

# Variables
REPO_URL="https://github.com/pljakobs/esp_rgb_mock_backend.git"
BACKEND_DIR="/srv/esp_rgb_mock_backend"
QUADLET_DIR="/etc/containers/systemd"
NGINX_CONF_SRC="$(pwd)/nginx-mock.conf"
NGINX_CONF_DEST="/srv/nginx-mock.conf"
MOCK_USER="mock"

# Create mock user if not exists
if ! id "$MOCK_USER" &>/dev/null; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$MOCK_USER"
fi

# Clone or update backend repo
if [ ! -d "$BACKEND_DIR/.git" ]; then
  echo "Cloning backend repo to $BACKEND_DIR..."
  git clone "$REPO_URL" "$BACKEND_DIR"
else
  echo "Updating backend repo in $BACKEND_DIR..."
  git -C "$BACKEND_DIR" pull
fi

# Set ownership
chown -R $MOCK_USER:$MOCK_USER "$BACKEND_DIR"

# Copy quadlet files
mkdir -p "$QUADLET_DIR"
cp mock-backend.container "$QUADLET_DIR/"
cp nginx.container "$QUADLET_DIR/"
chown root:root "$QUADLET_DIR/mock-backend.container" "$QUADLET_DIR/nginx.container"

# Copy nginx config
cp "$NGINX_CONF_SRC" "$NGINX_CONF_DEST"
chown $MOCK_USER:$MOCK_USER "$NGINX_CONF_DEST"

# Reload systemd manager
systemctl daemon-reload

# Enable and start services (system-wide)
systemctl enable --now podman-mock-backend.service
systemctl enable --now podman-nginx.service

echo "Installation complete. Backend will be available on port 80 via nginx, running as user 'mock'."
