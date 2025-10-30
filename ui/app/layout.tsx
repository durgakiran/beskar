import { Inter, Noto_Color_Emoji } from "next/font/google";
import "./global.css";
import SessionGuard from "./core/auth/sessionProvider";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";

const notoColorEmoji = Noto_Color_Emoji({ weight: "400", subsets: ["emoji"] });
const inter = Inter({ subsets: ["latin"] });

export const metadata = {
    title: "TedEDox",
    description: "Note taking platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className="light" style={{ colorScheme: 'light' }}>
            <body>
                <Theme
                    accentColor="plum"
                    grayColor="mauve"
                    panelBackground="translucent"
                    radius="small"
                    appearance="light"
                >
                    <SessionGuard>{children}</SessionGuard>
                </Theme>
            </body>
        </html>
    );
}
