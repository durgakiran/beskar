import Header from "./menuBar";


export default function SpaceLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <Header />
            <div className="bg-white dark:border-gray-700 dark:bg-gray-800 px-4 pt-16 mx-auto max-w-8xl">{children}</div>
        </>
    );
}
