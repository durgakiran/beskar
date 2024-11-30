import { Sidebar } from "flowbite-react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

export default function SideNav() {
    const pathName = usePathname();

    useEffect((() => {
        console.log(pathName.split("/")[-1])
    }))

    return (
        <div>
            <Sidebar aria-label="Settings navigation">
                <Sidebar.Items>
                    <Sidebar.ItemGroup>
                        <Sidebar.Item active={pathName.split("/")[-1] === "users"} href="#">
                            Active Users
                        </Sidebar.Item>
                        <Sidebar.Item href="#">
                            Invited Users
                        </Sidebar.Item>
                    </Sidebar.ItemGroup>
                </Sidebar.Items>
            </Sidebar>
        </div>
    );
}

