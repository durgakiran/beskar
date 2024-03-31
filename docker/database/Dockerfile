FROM postgres:16.2

# Install dependencies
RUN apt-get update && apt-get install -y \
    wget \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y openjdk-17-jdk openjdk-17-jre

# Create a directory for storing Liquibase files
RUN mkdir /app

WORKDIR /app

VOLUME [ "/app" ]

ENTRYPOINT ["/app/docker/database/db-init.sh"]
