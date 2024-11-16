import { apiBaseUrl, AuthClientConfig } from "next-auth/client/_utils";
import { BuiltInProviderType, RedirectableProviderType } from "next-auth/providers";
import { getCsrfToken, getProviders, LiteralUnion, SignInAuthorizationParams, SignInOptions, SignInResponse } from "next-auth/react";

export interface InternalUrl {
    /** @default "http://localhost:3000" */
    origin: string;
    /** @default "localhost:3000" */
    host: string;
    /** @default "/api/auth" */
    path: string;
    /** @default "http://localhost:3000/api/auth" */
    base: string;
    /** @default "http://localhost:3000/api/auth" */
    toString: () => string;
}

export default function parseUrl(url?: string): InternalUrl {
    const defaultUrl = new URL("http://localhost:3000/api/auth");

    if (url && !url.startsWith("http")) {
        url = `https://${url}`;
    }

    const _url = new URL(url ?? defaultUrl);
    const path = (_url.pathname === "/" ? defaultUrl.pathname : _url.pathname)
        // Remove trailing slash
        .replace(/\/$/, "");

    const base = `${_url.origin}${path}`;

    return {
        origin: _url.origin,
        host: _url.host,
        path,
        base,
        toString: () => base,
    };
}

// This behaviour mirrors the default behaviour for getting the site name that
// happens server side in server/index.js
// 1. An empty value is legitimate when the code is being invoked client side as
//    relative URLs are valid in that context and so defaults to empty.
// 2. When invoked server side the value is picked up from an environment
//    variable and defaults to 'http://localhost:3000'.
const __NEXTAUTH: AuthClientConfig = {
    baseUrl: parseUrl(process.env.NEXTAUTH_URL ?? process.env.VERCEL_URL).origin,
    basePath: parseUrl(process.env.NEXTAUTH_URL).path,
    baseUrlServer: parseUrl(process.env.NEXTAUTH_URL_INTERNAL ?? process.env.NEXTAUTH_URL ?? process.env.VERCEL_URL).origin,
    basePathServer: parseUrl(process.env.NEXTAUTH_URL_INTERNAL ?? process.env.NEXTAUTH_URL).path,
    _lastSync: 0,
    _session: undefined,
    _getSession: () => {},
};

export async function signIn<P extends RedirectableProviderType | undefined = undefined>(
    provider?: LiteralUnion<P extends RedirectableProviderType ? P | BuiltInProviderType : BuiltInProviderType>,
    options?: SignInOptions,
    authorizationParams?: SignInAuthorizationParams,
): Promise<P extends RedirectableProviderType ? SignInResponse | undefined : undefined> {
    const { callbackUrl = window.location.href, redirect = true } = options ?? {};

    const baseUrl = apiBaseUrl(__NEXTAUTH);
    const providers = await getProviders();

    if (!providers) {
        window.location.href = `${baseUrl}/error`;
        return;
    }

    if (!provider || !(provider in providers)) {
        window.location.href = `${baseUrl}/auth/login?${new URLSearchParams({
            callbackUrl,
        })}`;
        return;
    }

    const isCredentials = providers[provider].type === "credentials";
    const isEmail = providers[provider].type === "email";
    const isSupportingReturn = isCredentials || isEmail;

    const signInUrl = `${baseUrl}/${isCredentials ? "callback" : "signin"}/${provider}`;

    const _signInUrl = `${signInUrl}${authorizationParams ? `?${new URLSearchParams(authorizationParams)}` : ""}`;

    const res = await fetch(_signInUrl, {
        method: "post",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        // @ts-expect-error
        body: new URLSearchParams({
            ...options,
            csrfToken: await getCsrfToken(),
            callbackUrl,
            json: true,
        }),
    });

    const data = await res.json();

    // TODO: Do not redirect for Credentials and Email providers by default in next major
    if (redirect || !isSupportingReturn) {
        const url = data.url ?? callbackUrl;
        // change url base
        const urlObj = new URL(url);
        console.log(urlObj);
        urlObj.hostname = 'localhost';
        urlObj.port = '8084';
        console.log(urlObj)
        window.location.href = url;
        // If url contains a hash, the browser does not reload the page. We reload manually
        if (url.includes("#")) window.location.reload();
        return;
    }

    const error = new URL(data.url).searchParams.get("error");

    if (res.ok) {
        await __NEXTAUTH._getSession({ event: "storage" });
    }

    return {
        error,
        status: res.status,
        ok: res.ok,
        url: error ? null : data.url,
    } as any;
}
