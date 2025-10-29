'use client'

import SideNav from "@components/sidenav"
import { use } from "react"


export default function Layout({ children, params }: { children: React.ReactNode, params: Promise<{ spaceId: string }> }) {
    const { spaceId } = use(params);

    return (
        <div className="flex space-x-4 min-h-svh">
            <div>
                <SideNav id={spaceId} />
            </div>
            <div className="grow">
                {children}
            </div>
        </div>
    )

}