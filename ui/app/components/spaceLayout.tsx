import Header from "./menuBar";


export default function SpaceLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <Header />
            <div className="min-h-screen bg-[var(--background)] pt-[73px]">
                <div className="mx-auto w-full max-w-[1440px]">
                    {children}
                </div>
            </div>
        </>
    );
}
