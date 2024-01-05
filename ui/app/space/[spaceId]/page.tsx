'use client'
export default function Page({ params }: { params: { spaceId: string } }) {
    return (
        <div>spaceId: {params.spaceId}</div>
    )
}
