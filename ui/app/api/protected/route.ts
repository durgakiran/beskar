import { NextApiRequest, NextApiResponse } from "next";
import { getToken } from "next-auth/jwt";

export async function  GET(req: NextApiRequest) {
    const token = await getToken({ raw: true, req });
    return Response.json({token});
}
