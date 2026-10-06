/** Takım formu girdisi doğrulaması (saf). Sunucu action'ı ve testler aynı kuralı kullanır. */
export type TeamInput = { name: string; branchId: string | null; leadUserId: string | null; isActive: boolean | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseTeamInput(fd: { get(k: string): FormDataEntryValue | null; has(k: string): boolean }): { ok: true; value: TeamInput } | { ok: false; error: string } {
  const name = String(fd.get("name") ?? "").replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "Takım adı zorunlu." };
  if (name.length > 80) return { ok: false, error: "Takım adı en fazla 80 karakter olabilir." };
  const branchRaw = String(fd.get("branch_id") ?? "").trim();
  const leadRaw = String(fd.get("lead_user_id") ?? "").trim();
  if (branchRaw && !UUID_RE.test(branchRaw)) return { ok: false, error: "Şube geçersiz." };
  if (leadRaw && !UUID_RE.test(leadRaw)) return { ok: false, error: "Takım lideri geçersiz." };
  const isActive = fd.has("is_active") ? String(fd.get("is_active")) === "true" : null;
  return { ok: true, value: { name, branchId: branchRaw || null, leadUserId: leadRaw || null, isActive } };
}
