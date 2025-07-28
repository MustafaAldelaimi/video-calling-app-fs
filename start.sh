#!/bin/bash

# Set production settings
export DJANGO_SETTINGS_MODULE=config.settings.production

# Debug environment variables
echo "Environment variables:"
echo "PGHOST: $PGHOST"
echo "PGUSER: $PGUSER" 
echo "PGDATABASE: $PGDATABASE"
echo "DATABASE_URL: ${DATABASE_URL:0:20}..." # Show first 20 chars only
echo "REDIS_URL: ${REDIS_URL:0:20}..."

# Wait for database to be ready
echo "Waiting for database..."
python manage.py check --database default

# Run migrations
echo "Running migrations..."
python manage.py migrate --noinput

# Collect static files
echo "Collecting static files..."
python manage.py collectstatic --noinput

# Start the server with ASGI support for WebSockets
echo "Starting ASGI server with WebSocket support..."
exec daphne -b 0.0.0.0 -p $PORT config.asgi:application 