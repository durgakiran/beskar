FROM postgres:16.2

ARG LIQUIBASE_VERSION=4.27.0

RUN apt-get -o Acquire::ForceIPv4=true update && apt-get -o Acquire::ForceIPv4=true install -y \
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

RUN mkdir -p /app/docker/database/liquibasebin \
    && curl -4 -fsSL "https://github.com/liquibase/liquibase/releases/download/v${LIQUIBASE_VERSION}/liquibase-${LIQUIBASE_VERSION}.zip" -o /tmp/liquibase.zip \
    && unzip /tmp/liquibase.zip -d /app/docker/database/liquibasebin \
    && rm -f /tmp/liquibase.zip

RUN chmod +x /app/docker/database/db-init.sh

ENTRYPOINT ["/app/docker/database/db-init.sh"]
