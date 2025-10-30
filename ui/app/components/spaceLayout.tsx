import Header from "./menuBar";


export default function SpaceLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <Header />
            <div className="bg-white px-4 pt-16 mx-auto max-w-8xl">{children}</div>
        </>
    );
}
