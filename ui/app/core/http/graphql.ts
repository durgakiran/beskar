'use client'
import { ApolloClient, InMemoryCache } from "@apollo/client";
export const client = () =>{
    return new ApolloClient({
                uri: process.env.NEXT_PUBLIC_HASURA_PROJECT_ENDPOINT,
                cache: new InMemoryCache(),
                headers: {
                    "Authorization": typeof window !== 'undefined' ?  `Bearer ${(localStorage as any).getItem('access_token')}` : ''
                }
            });
}
