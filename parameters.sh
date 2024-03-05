PARAMETERS=$(aws ssm get-parameter --name beskar-dev-parameters --with-decryption | jq '.Parameter.Value | fromjson')

# replace GITHUB_ID
GITHUB_ID=$(echo "$PARAMETERS" | jq -r '.GITHUB_ID')
sed -i "s/@GITHUB_ID@/$GITHUB_ID/" ./ui/.env.local

# replace GITHUB_SECRET
GITHUB_SECRET=$(echo "$PARAMETERS" | jq -r '.GITHUB_SECRET')
sed -i "s/@GITHUB_SECRET@/$GITHUB_SECRET/" ./ui/.env.local


# replace HASURA_ADMIN_SECRET
HASURA_ADMIN_SECRET=$(echo "$PARAMETERS" | jq -r '.HASURA_ADMIN_SECRET')
sed -i "s/@HASURA_ADMIN_SECRET@/$HASURA_ADMIN_SECRET/" ./ui/.env.local

# replace GITHUB_ID
GITHUB_ID=$(echo "$PARAMETERS" | jq -r '.GITHUB_ID')
sed -i "s/@GITHUB_ID@/$GITHUB_ID/" ./.env.local

# replace GITHUB_SECRET
GITHUB_SECRET=$(echo "$PARAMETERS" | jq -r '.GITHUB_SECRET')
sed -i "s/@GITHUB_SECRET@/$GITHUB_SECRET/" ./.env.local


# replace HASURA_ADMIN_SECRET
HASURA_ADMIN_SECRET=$(echo "$PARAMETERS" | jq -r '.HASURA_ADMIN_SECRET')
sed -i "s/@HASURA_ADMIN_SECRET@/$HASURA_ADMIN_SECRET/" ./.env.local

# replace HASURA_ADMIN_SECRET in docker compose file
HASURA_ADMIN_SECRET=$(echo "$PARAMETERS" | jq -r '.HASURA_ADMIN_SECRET')
sed -i "s/@HASURA_ADMIN_SECRET@/$HASURA_ADMIN_SECRET/" ./docker-compose.yml
