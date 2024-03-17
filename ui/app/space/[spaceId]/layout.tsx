'use client'

import SideNav from "@components/sidenav"


export default function Layout({ children, params }: { children: React.ReactNode, params: { spaceId: string } }) {

    return (
        <div className="flex space-x-4">
            <div>
                <SideNav id={params.spaceId} />
            </div>
            <div className="grow">
                {children}
            </div>
        </div>
    )

}