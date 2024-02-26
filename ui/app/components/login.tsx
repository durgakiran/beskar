"use client"
import { get } from "@http";
import { signIn, signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Login() {
    const { data: session } = useSession()
    const router = useRouter();
    
    useEffect(() => {
      (async () => {
        try {
          const data = await get('/api/protected');
          if (data && data.data && data.data.token) {
            localStorage.setItem('access_token', data.data.token);
            router.push('/space');
          }
        } catch(e) {
          console.error(e);
        }

      })();
    }, [session]);

    if (session) {
        return (
          <>
            Signed in as {session.user.email} <br />
            <button onClick={() => signOut()}>Sign out</button>
          </>
        )
      }
      return (
        <>
          Not signed in <br />
          <button onClick={() => signIn()}>Sign in</button>
        </>
      )
}
