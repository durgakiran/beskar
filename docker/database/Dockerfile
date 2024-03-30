FROM postgres:16.2

# Install dependencies
RUN apt-get update && apt-get install -y \
    wget \
    && rm -rf /var/lib/apt/lists/*



# Create a directory for storing Liquibase files
RUN mkdir /app

WORKDIR /app

VOLUME [ "/app" ]

ENTRYPOINT ["/app/docker/database/db-init.sh"]
