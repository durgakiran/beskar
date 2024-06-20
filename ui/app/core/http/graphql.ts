"use client";
import { ApolloClient, from, HttpLink, InMemoryCache } from "@apollo/client";
import { onError } from "@apollo/client/link/error"


const URI = process.env.NEXT_PUBLIC_HASURA_PROJECT_ENDPOINT;

const errorLink = onError(({ graphQLErrors }) => {
    if (graphQLErrors) {
        graphQLErrors.forEach((error) => {
            if ((error.extensions.code as string).toLowerCase() === "invalid-jwt") {
                // TODO: refresh token
            }
        });
    }
});

const httpLink =  new HttpLink({
    uri: URI,
    headers: {
        Authorization: typeof window !== "undefined" ? `Bearer ${localStorage.getItem("access_token")}` : "",
    }
});

export const client = new ApolloClient({
    link: from([errorLink, httpLink]),
    cache: new InMemoryCache(),
});
