FROM postgres:16.2

ENV GITHUB_CLIENT_ID=GITHUB_CLIENT_ID
ENV GITHUB_CLIENT_SECRET=GITHUB_CLIENT_SECRET

# Install dependencies
RUN apt-get update && apt-get install -y \
    wget jq curl\
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y openjdk-17-jdk openjdk-17-jre

# Create a directory for storing Liquibase files
RUN mkdir /app

WORKDIR /app

VOLUME [ "/app" ]

ENTRYPOINT ["/app/docker/app/app-init.sh"]
