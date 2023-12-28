import { ApolloClient, InMemoryCache } from "@apollo/client";

export const client = new ApolloClient({
    uri: process.env.NEXT_PUBLIC_HASURA_PROJECT_ENDPOINT,
    cache: new InMemoryCache(),
    headers: {
        "Authorization": `Bearer ${localStorage.getItem('access_token')}`
    }
});
