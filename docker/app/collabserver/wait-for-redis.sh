#!/bin/sh
# wait-for-redis.sh

set -e

# Default Redis configuration
REDIS_HOST=${REDIS_HOST:-tededox-redis}
REDIS_PORT=${REDIS_PORT:-6379}
REDIS_PASSWORD=${REDIS_PASSWORD:-redis_secure_password}

echo "Waiting for Redis to be available at $REDIS_HOST:$REDIS_PORT..."

# Function to check Redis availability
check_redis() {
    redis-cli -h $REDIS_HOST -p $REDIS_PORT -a $REDIS_PASSWORD ping > /dev/null 2>&1
}

# Keep checking until Redis responds
until check_redis; do
    echo "Redis is unavailable - sleeping"
    sleep 1
done

echo "Redis is up and running!"
exec "$@" 