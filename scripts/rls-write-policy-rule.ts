/**
 * RLS YAZMA POLİTİKASI KURALI (SK10 / B159 + B182) — SAF; DB yok. `scripts/rls-audit.ts` canlı/gölge kataloğa uygular,
 * `src/lib/permissions-matrix-contract.test.ts` örneklerle kilitler.
 *
 * Kural: kiracı (tenant) koşulu taşıyan her YAZMA politikası (ALL / INSERT / UPDATE / DELETE) ya bir İZİN koşulu
 * (has_effective_permission, rol yardımcısı ...) ya da bir KENDİ-SATIR koşulu (auth.uid()) içermeli. Yalnız
 * `tenant_id = current_tenant_id()` diyen yazma politikası, ofisteki HER rolün (danışman dahil) o tabloya yazabilmesi
 * demektir (B159: automations, contract_templates ... 32 tablo). Yalnız service_role'e açık politikalar kural dışıdır.
 */

export type WritePolicyRow = {
  tablename: string;
  policyname: string;
  cmd: string;
  /** pg_policies.roles (ör. "{authenticated}", "{public}", "{service_role}"). */
  roles: string;
  qual: string | null;
  with_check: string | null;
};

export type WritePolicyFinding = { tablo: string; politika: string; detay: string };

/** İzin ya da kendi-satır koşulu sayılan ifadeler (pg_get_expr çıktısı; şema öneki olabilir). */
export const WRITE_POLICY_GUARD_RE = new RegExp(
  [
    "has_effective_permission\\(",
    "has_permission_with_scope\\(",
    "current_profile_role\\(",
    "(?<![a-z_])(?:auth\\.)?uid\\(\\)",
    "survey_is_manager\\(",
    "survey_can_work_task\\(",
    "custom_field_can_write\\(",
    "is_platform_staff\\(",
    "is_platform_admin\\(",
    "fsbo_[a-z_]*role\\(",
    "support_is_ticket_staff\\(",
    "lc_can_[a-z_]+\\(",
    "listing_pool_entry_[a-z_]+\\(",
    "scope_allows\\(",
    "approval_actor_can_decide\\(",
  ].join("|"),
  "i",
);

const TENANT_RE = /\b(?:from_|to_)?tenant_id\b|current_tenant_id\(|current_active_tenant_id\(/i;
const WRITE_CMDS = new Set(["ALL", "INSERT", "UPDATE", "DELETE"]);
const SERVICE_ONLY_ROLES = new Set(["service_role", "postgres", "supabase_admin"]);

function rolesOf(raw: string): string[] {
  return raw.replace(/^\{|\}$/g, "").split(",").map((r) => r.trim().replace(/^"|"$/g, "")).filter(Boolean);
}

/** Tümüyle reddeden ifade (`false`): koşul gerekmez. */
function isDenyAll(expr: string | null): boolean {
  return expr !== null && /^\s*\(?\s*false\s*\)?\s*$/i.test(expr);
}

/**
 * Bir yazma politikasının yetki kararını veren ifadeleri (komuta göre). UPDATE/DELETE'te hedef satırı seçen USING;
 * INSERT'te WITH CHECK; ALL'da ikisi de (ekleme yolu WITH CHECK'ten geçer). UPDATE'in WITH CHECK'i yalnız satırın
 * kiracıda kalmasını sağlar; yetki USING'dedir.
 */
function authorizingExprs(row: WritePolicyRow): string[] {
  const out: string[] = [];
  if (row.cmd === "INSERT") {
    if (row.with_check !== null) out.push(row.with_check);
    return out;
  }
  if (row.qual !== null) out.push(row.qual);
  if (row.cmd === "ALL" && row.with_check !== null) out.push(row.with_check);
  return out;
}

/** Kuralı ihlal eden yazma politikaları (boş = temiz). */
export function findUnguardedWritePolicies(rows: readonly WritePolicyRow[]): WritePolicyFinding[] {
  const findings: WritePolicyFinding[] = [];
  for (const row of rows) {
    if (!WRITE_CMDS.has(row.cmd.toUpperCase())) continue;
    const roles = rolesOf(row.roles);
    if (roles.length > 0 && roles.every((r) => SERVICE_ONLY_ROLES.has(r))) continue;
    const exprs = authorizingExprs({ ...row, cmd: row.cmd.toUpperCase() });
    const all = exprs.join(" ");
    if (!TENANT_RE.test(all)) continue; // kiracı koşulu taşımayan (ör. yalnız kendi satırı) politikalar bu kuralın dışında
    const unguarded = exprs.filter((e) => !isDenyAll(e) && !WRITE_POLICY_GUARD_RE.test(e));
    if (unguarded.length > 0) {
      findings.push({
        tablo: row.tablename,
        politika: row.policyname,
        detay: `${row.cmd} politikası yalnız kiracı koşulu taşıyor (izin ya da auth.uid() yok): ${unguarded[0].slice(0, 160)}`,
      });
    }
  }
  return findings;
}
