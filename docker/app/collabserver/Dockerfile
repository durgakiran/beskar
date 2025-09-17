FROM node:18-alpine

WORKDIR /app

# Install Redis CLI tools
RUN apk add --no-cache redis ca-certificates curl

# Update the ca-certificates file
RUN update-ca-certificates

# Copy the wait script and make it executable
COPY wait-for-redis.sh /app/wait-for-redis.sh
RUN chmod +x /app/wait-for-redis.sh

# Expose the port
EXPOSE 1234

# Use the wait script to ensure Redis is ready before starting the application
CMD ["/bin/sh", "/app/wait-for-redis.sh", "npm", "run", "start"] 
