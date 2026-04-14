import Header from "./menuBar";


export default function SpaceLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <Header />
            <div className="box-border h-screen overflow-hidden bg-[var(--background)] pt-[73px]">
                <div className="mx-auto h-full w-full max-w-[1440px]">
                    {children}
                </div>
            </div>
        </>
    );
}
