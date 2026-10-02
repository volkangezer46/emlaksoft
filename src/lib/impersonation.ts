import { cookies } from "next/headers";

export const IMPERSONATE_COOKIE = "es_impersonate_tenant";

const IMPERSONATION_KEYS = [
  "tenant_id",
  "role",
  "impersonating",
  "home_tenant_id",
  "home_role",
  "impersonation_session_id",
] as const;

/**
 * GoTrue metadata guncellemeleri merge edebildigi icin yalnız spread etmek
 * yeterli degildir. Impersonation sirasinda eklenen ama orijinal snapshot'ta
 * bulunmayan anahtarlar acikca null/false yapilir; home tenant null olsa da
 * kullanici destek tenant'inda takili kalmaz.
 */
export function restoreImpersonationMetadata(
  current: Record<string, unknown>,
  original: Record<string, unknown>,
): Record<string, unknown> {
  const restored: Record<string, unknown> = { ...current, ...original };
  for (const key of IMPERSONATION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(original, key)) {
      restored[key] = key === "impersonating" ? false : null;
    }
  }
  return restored;
}

export function impersonationCookieOptions(httpOnly: boolean) {
  return {
    httpOnly,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 4,
  };
}

export async function getImpersonatedTenantId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(IMPERSONATE_COOKIE)?.value ?? null;
}
