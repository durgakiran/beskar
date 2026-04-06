import { Geist, Noto_Color_Emoji } from "next/font/google";
import "./global.css";
import SessionGuard from "./core/auth/sessionProvider";
import { Theme } from "@radix-ui/themes";

const notoColorEmoji = Noto_Color_Emoji({ weight: "400", subsets: ["emoji"] });
const geist = Geist({ subsets: ["latin"] });

export const metadata = {
    title: "TedEDox",
    description: "Note taking platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className="light" style={{ colorScheme: 'light' }}>
            <body className={`${geist.className} ${notoColorEmoji.className}`}>
                <Theme
                    accentColor="blue"
                    grayColor="slate"
                    panelBackground="solid"
                    radius="small"
                    appearance="light"
                >
                    <SessionGuard>{children}</SessionGuard>
                </Theme>
            </body>
        </html>
    );
}
