FROM postgres:16.2

RUN apt-get update && apt-get install -y \
    wget \
    jq \
    curl \
    unzip \
    openjdk-17-jdk \
    openjdk-17-jre \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY db /app/db
COPY docker/database/db-init.sh /app/docker/database/db-init.sh
COPY docker/database/liquibasebin /app/docker/database/liquibasebin

RUN chmod +x /app/docker/database/db-init.sh

ENTRYPOINT ["/app/docker/database/db-init.sh"]
