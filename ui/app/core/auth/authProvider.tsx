'use client'

import { SessionProvider } from "next-auth/react"
import { ReactNode } from "react"

export function AuthProviders({ children }: { children: ReactNode }) {
  return (
    <SessionProvider refetchInterval={4 * 60}>
      {children}
    </SessionProvider>
  )
}
