'use client'

import SideNav from "@components/sidenav"
import { PageLayout } from "@primer/react"


export default function Layout({children, params}: {children: React.ReactNode, params: { spaceId: string }}) {

    return (
        <PageLayout containerWidth="full">
            <PageLayout.Pane resizable position="start">
                <SideNav id={params.spaceId}/>
            </PageLayout.Pane>
            <PageLayout.Content>
                {children}
            </PageLayout.Content>
        </PageLayout>
    )
    
}