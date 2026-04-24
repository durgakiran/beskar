import { NextRequest, NextResponse } from "next/server";
import { CURRENT_PATH_HEADER } from "./app/core/auth/returnTo";

export function middleware(request: NextRequest) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(CURRENT_PATH_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);

    return NextResponse.next({
        request: {
            headers: requestHeaders,
        },
    });
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
