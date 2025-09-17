import { cookies } from "next/headers";
import { redirect } from "next/navigation";
const USER_URI = process.env.NEXT_PUBLIC_USER_SERVER_URL;

const get = async (cookies: { name: string; value: string }[]) => {
    const res = await fetch(`${USER_URI}/profile/details`, {
        method: "GET",
        cache: "no-cache",
        redirect: "follow",
        headers: {
            "Content-Type": "application/json",
            Cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
        },
    });
    if (res.status < 200 || res.status > 300) {
        return {
            response: res.status,
            data: null,
        };
    }

    return {
        response: res.status,
        data: await res.json(),
    };
};

export default async function Home() {
    const cookieStore = cookies();
    const res = await get(cookieStore.getAll());

    if (res.response !== 200) {
        redirect("/auth/login");
    }

    if (res.response === 200) {
        redirect("/space");
    }

    return (
        <div>
            <h2>Hello {res.data.data.name}</h2>
            <h3>Welcome to Ted Dox!</h3>
        </div>
    );
}
