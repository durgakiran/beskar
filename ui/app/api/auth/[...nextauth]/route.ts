import NextAuth, { NextAuthOptions } from "next-auth";
import GithubProvider from "next-auth/providers/github";
import { JWT, getToken } from "next-auth/jwt";
import * as jsonwebtoken from "jsonwebtoken";
import { HasuraAdapter } from "@auth/hasura-adapter";

const authOptions: NextAuthOptions = {
  // https://next-auth.js.org/configuration/providers/oauth
  providers: [
    GithubProvider({
        clientId: process.env.GITHUB_ID,
        clientSecret: process.env.GITHUB_SECRET,
    }),
  ],
  debug: true,
  adapter: HasuraAdapter({
        endpoint: process.env.HASURA_PROJECT_ENDPOINT!,
        adminSecret: process.env.HASURA_ADMIN_SECRET!,
  }),
  theme: {
        colorScheme: "auto",
  },
  // Use JWT strategy so we can forward them to Hasura
  session: { strategy: "jwt" },
  // Encode and decode your JWT with the HS256 algorithm
  jwt: {
    encode: ({ secret, token }) => {
        console.log("secret", secret);
        const encodedToken = jsonwebtoken.sign(token!, secret, {
            algorithm: "HS256",
        });
        return encodedToken;
    },
    decode: async ({ secret, token }) => {
        const decodedToken = jsonwebtoken.verify(token!, secret, {
            algorithms: ["HS256"],
        });
        return decodedToken as JWT;
    },
  },
  callbacks: {
    // Add the required Hasura claims
    // https://hasura.io/docs/latest/graphql/core/auth/authentication/jwt/#the-spec
    async jwt({ token, user, account }) {
        if (account) {
            token.accessToken = account.access_token;
        }
        return {
                ...token,
                "https://hasura.io/jwt/claims": {
                "x-hasura-allowed-roles": ["user"],
                "x-hasura-default-role": "user",
                "x-hasura-role": "user",
                "x-hasura-user-id": token.sub,
            },
        };
    },
    // Add user ID to the session
    session: async ({ session, token }) => {
        console.log("token", token);
        if (session?.user) {
            session.user.id = token.sub!;
            session.accessToken = token.accessToken as string;
        }
        return session;
    },
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
