"use client"
import SideNav from "@components/settings/sidenav";

export default function Layout({ children, params }: { children: React.ReactNode, params: { spaceId: string } }) {
    return (
        <div className="flex space-x-4">
            <SideNav id={params.spaceId} />
            <div className="grow">
                {children}
            </div>
        </div>
    )
}

