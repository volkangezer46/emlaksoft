const FORBIDDEN_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".test",
  ".invalid",
  ".onion",
];

function normalizedHosts(hosts: readonly string[]): Set<string> {
  return new Set(
    hosts
      .flatMap((value) => value.split(","))
      .map((value) => value.trim().toLowerCase().replace(/\.$/, ""))
      .filter((value) => /^[a-z0-9.-]+$/.test(value) && value.includes(".")),
  );
}

export function providerAllowedHosts(
  defaults: readonly string[],
  envValue?: string | null,
): readonly string[] {
  return [...normalizedHosts([...defaults, envValue ?? ""])];
}

/**
 * Normalizes a server-side provider base URL and rejects SSRF-capable targets.
 * Hosts are exact allow-list entries: arbitrary subdomains, IP literals, local
 * names, credentials, non-HTTPS schemes and non-standard ports fail closed.
 */
export function normalizeProviderBaseUrl(
  raw: string,
  allowedHosts: readonly string[],
): string | null {
  const input = raw.trim();
  if (!input || /[\\\u0000-\u001f\u007f]/.test(input)) return null;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const allow = normalizedHosts(allowedHosts);
  if (
    url.protocol !== "https:" ||
    Boolean(url.username || url.password) ||
    Boolean(url.search || url.hash) ||
    Boolean(url.port && url.port !== "443") ||
    !hostname.includes(".") ||
    hostname === "localhost" ||
    /^\[.*\]$/.test(url.host) ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
    FORBIDDEN_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
    !allow.has(hostname)
  ) {
    return null;
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}

export const PROVIDER_REQUEST_TIMEOUT_MS = 15_000;
