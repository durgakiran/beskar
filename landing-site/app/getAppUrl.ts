const DEFAULT_APP_URL = "https://app.durgakiran.com";

function firstHeaderValue(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.split(",")[0]?.trim() ?? null;
}

function getRequestOrigin(headers: Headers): string | null {
  const forwardedHost = firstHeaderValue(headers.get("x-forwarded-host"));
  const host = forwardedHost ?? firstHeaderValue(headers.get("host"));

  if (!host) {
    return null;
  }

  const forwardedProto = firstHeaderValue(headers.get("x-forwarded-proto"));
  const proto =
    forwardedProto ?? (host.includes("localhost") ? "http" : "https");

  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

export function getAppUrl(headers: Headers): string {
  const origin = getRequestOrigin(headers);

  if (!origin) {
    return DEFAULT_APP_URL;
  }

  const url = new URL(origin);

  if (!url.hostname.startsWith("power.")) {
    return DEFAULT_APP_URL;
  }

  url.hostname = `app.${url.hostname.slice("power.".length)}`;

  return url.origin;
}
