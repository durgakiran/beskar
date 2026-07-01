import { Outlet, useParams } from "react-router-dom";
import SettingsTabs from "@components/settings/SettingsTabs";

export default function Layout() {
    const { spaceId } = useParams() as any;
    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 md:px-6">
            <SettingsTabs spaceId={spaceId} />
            <div className="min-h-0">
                <Outlet />
            </div>
        </div>
    );
}
