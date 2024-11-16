import { Inter, Noto_Color_Emoji } from "next/font/google";
import "./global.css";
import SessionGuard from "./core/auth/sessionProvider";

const notoColorEmoji = Noto_Color_Emoji({ weight: "400", subsets: ["emoji"] });
const inter = Inter({ subsets: ["latin"] });

export const metadata = {
    title: "TedEDox",
    description: "Note taking platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body>
                <div>
                    <SessionGuard>{children}</SessionGuard>
                </div>
            </body>
        </html>
    );
}
