import { cookies } from "next/headers";

export const IMPERSONATE_COOKIE = "es_impersonate_tenant";

export async function getImpersonatedTenantId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(IMPERSONATE_COOKIE)?.value ?? null;
}
