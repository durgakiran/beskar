import { getToken } from "next-auth/jwt";
import { NextRequest } from "next/server";

export async function  GET(req: NextRequest) {
    const token = await getToken({ raw: true, req });
    return Response.json({token});
}
