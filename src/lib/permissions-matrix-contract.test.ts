import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_MATRIX, type AppAction, type AppModule, type AppRole } from "./permissions";
import { mergeEffectivePermissions } from "./permissions-merge";
import { canDecideApproval } from "./approvals";
import { canEditRolePermissions, poolBranchRule } from "./access-control/admin-rules";
import { findUnguardedWritePolicies, type WritePolicyRow } from "../../scripts/rls-write-policy-rule";

/**
 * SÖZLEŞME — SK10 (B182, B161, B164, B165, B159): yetki matrisi ve yetki kurallarının TEK kaynakları.
 *
 *  - `DEFAULT_MATRIX` (kod) ile `permission_defaults` (DB) BİREBİR eşittir. DB kısmı yalnız
 *    `PERMISSION_DEFAULTS_DB_URL` verilince koşar (salt-okunur SELECT): SK1'in provasında gölge/yayın veritabanına karşı
 *    `PERMISSION_DEFAULTS_DB_URL=postgres://... npx vitest run src/lib/permissions-matrix-contract.test.ts`.
 *    Statik kısım her koşuda: salt okunur tavanı yalnız `view` taşır, readonly Yardım'ı (support:view) görür ve bu
 *    satır migration'da DB'ye yazılır.
 *  - Rol matrisi düzenleme kuralı, onay karar yüklemi, havuz şube kuralı ve RLS yazma politikası kuralı örneklerle kilitli.
 */

const ROOT = process.cwd();

type DefaultRow = { role: string; module: string; action: string };
type PgClient = { connect(): Promise<void>; query(sql: string): Promise<{ rows: DefaultRow[] }>; end(): Promise<void> };
/** `pg` yalnız DB'li koşuda yüklenir (src tsconfig'inde tip paketi yok; değişken belirteç tip çözümünü atlar). */
async function pgClient(connectionString: string): Promise<PgClient> {
  const moduleName = "pg";
  const mod = (await import(/* @vite-ignore */ moduleName)) as { default: { Client: new (o: { connectionString: string; ssl?: false }) => PgClient } };
  return new mod.default.Client({ connectionString, ssl: /sslmode=disable|host=\//.test(connectionString) ? false : undefined });
}

function matrixRows(): Set<string> {
  const out = new Set<string>();
  for (const [role, mods] of Object.entries(DEFAULT_MATRIX)) {
    for (const [mod, actions] of Object.entries(mods ?? {})) for (const a of actions ?? []) out.add(`${role}|${mod}|${a}`);
  }
  return out;
}

describe("DEFAULT_MATRIX ↔ permission_defaults", () => {
  it("salt okunur tavanı: readonly yalnız 'view' taşır ve Yardım'ı (support:view) görür", () => {
    for (const actions of Object.values(DEFAULT_MATRIX.readonly)) expect(actions).toEqual(["view"]);
    expect(DEFAULT_MATRIX.readonly.support).toEqual(["view"]);
  });

  it("readonly support:view DB kopyası migration'da (idempotent) yazılır", () => {
    const sql = readFileSync(join(ROOT, "supabase/migrations/20261016100200_trp_gm_guard_readonly_support.sql"), "utf8");
    expect(sql).toMatch(/insert into public\.permission_defaults \(role, module, action\)\s*values \('readonly', 'support', 'view'\)\s*on conflict \(role, module, action\) do nothing/);
  });

  const url = process.env.PERMISSION_DEFAULTS_DB_URL;
  it.skipIf(!url)("DB permission_defaults kümesi DEFAULT_MATRIX ile birebir aynı (salt-okunur)", async () => {
    const client = await pgClient(url as string);
    await client.connect();
    try {
      const { rows } = await client.query("select role, module, action from public.permission_defaults");
      const db = new Set(rows.map((r) => `${r.role}|${r.module}|${r.action}`));
      const code = matrixRows();
      expect({
        koddaVarDbdeYok: [...code].filter((k) => !db.has(k)).sort(),
        dbdeVarKoddaYok: [...db].filter((k) => !code.has(k)).sort(),
      }).toEqual({ koddaVarDbdeYok: [], dbdeVarKoddaYok: [] });
    } finally {
      await client.end();
    }
  });
});

describe("rol izin matrisi düzenleme kuralı (B161)", () => {
  it("gm kendi rolünü ve ofis sahibi rolünü düzenleyemez; owner gm'yi düzenler", () => {
    expect(canEditRolePermissions("gm", "gm").ok).toBe(false);
    expect(canEditRolePermissions("gm", "owner").ok).toBe(false);
    expect(canEditRolePermissions("owner", "owner").ok).toBe(false);
    expect(canEditRolePermissions("owner", "gm").ok).toBe(true);
    expect(canEditRolePermissions("gm", "advisor").ok).toBe(true);
    expect(canEditRolePermissions("branch_manager", "advisor").ok).toBe(false);
  });

  it("gm kendinde olmayan izni başka role veremez; geri almak serbest", () => {
    expect(canEditRolePermissions("gm", "advisor", { grant: true, actorHas: false }).ok).toBe(false);
    expect(canEditRolePermissions("gm", "advisor", { grant: false, actorHas: false }).ok).toBe(true);
    expect(canEditRolePermissions("owner", "advisor", { grant: true, actorHas: false }).ok).toBe(true);
  });

  it("RLS aynı kuralı taşır: gm satırını yalnız owner, owner satırını kimse yazmaz", () => {
    const sql = readFileSync(join(ROOT, "supabase/migrations/20261016100200_trp_gm_guard_readonly_support.sql"), "utf8");
    expect(sql).toMatch(/and role <> 'owner'\s*and \(role <> 'gm' or \(select public\.current_profile_role\(\)\) = 'owner'\)/);
  });
});

describe("onay karar yüklemi (B164): düğmeyi gören karar verebilir", () => {
  const perms = (role: AppRole, roleOverrides: { module: string; action: string; allowed: boolean }[] = []) =>
    mergeEffectivePermissions(role, roleOverrides, []);

  it("varsayılan matris: owner/gm karar verir; şube müdürü, takım lideri, danışman, muhasebe, salt okunur vermez", () => {
    expect(canDecideApproval("owner", perms("owner"))).toBe(true);
    expect(canDecideApproval("gm", perms("gm"))).toBe(true);
    for (const role of ["branch_manager", "team_lead", "advisor", "accounting", "readonly", "call_center"] as AppRole[]) {
      expect(canDecideApproval(role, perms(role)), role).toBe(false);
    }
  });

  it("ofis rol istisnasıyla TAM komisyon yetkisi (commissions:delete) verilen şube müdürü karar verir; kademe dışı rol yine vermez", () => {
    // WP2 (20261023040000): şube müdürü varsayılan matriste anlaşma için commissions:edit taşır; karar için delete gerekir.
    expect(canDecideApproval("branch_manager", perms("branch_manager"))).toBe(false);
    const grant = [{ module: "commissions", action: "delete", allowed: true }];
    expect(canDecideApproval("branch_manager", perms("branch_manager", grant))).toBe(true);
    expect(canDecideApproval("accounting", perms("accounting"))).toBe(false); // commissions:edit var ama kademe değil
    expect(canDecideApproval("owner", null)).toBe(false);
  });

  it("tüm karar yüzeyleri aynı yüklemi kullanır (sayfa, eylem, rozet, kabuk)", () => {
    const uses = [
      "src/app/app/onaylar/page.tsx",
      "src/app/actions/approvals.ts",
      "src/lib/nav-badges.ts",
      "src/lib/app-shell/bootstrap-core.ts",
    ];
    for (const rel of uses) expect(readFileSync(join(ROOT, rel), "utf8"), rel).toMatch(/canDecideApproval\(/);
    const page = readFileSync(join(ROOT, "src/app/app/onaylar/page.tsx"), "utf8");
    expect(page).toMatch(/decider && !benim \? \(\s*<DecisionControls/);
  });
});

describe("havuz şube sınırı (B165)", () => {
  it("şube müdürü yalnız kendi şubesinde atar; şubesizse atayamaz; diğer roller serbest", () => {
    const base = { actorRole: "branch_manager", actorBranchId: "b1", propertyBranchId: "b1", targetBranchId: "b1" };
    expect(poolBranchRule(base).ok).toBe(true);
    expect(poolBranchRule({ ...base, actorBranchId: null }).ok).toBe(false);
    expect(poolBranchRule({ ...base, propertyBranchId: "b2" }).ok).toBe(false);
    expect(poolBranchRule({ ...base, propertyBranchId: null }).ok).toBe(false);
    expect(poolBranchRule({ ...base, targetBranchId: "b2" }).ok).toBe(false);
    expect(poolBranchRule({ ...base, actorRole: "gm", actorBranchId: null, propertyBranchId: "b9" }).ok).toBe(true);
  });
});

describe("RLS yazma politikası kuralı (B159 / rls-audit YAZMA-IZIN-YOK)", () => {
  const row = (over: Partial<WritePolicyRow>): WritePolicyRow => ({
    tablename: "automations",
    policyname: "p",
    cmd: "INSERT",
    roles: "{authenticated}",
    qual: null,
    with_check: "(tenant_id = ( SELECT current_tenant_id() AS current_tenant_id))",
    ...over,
  });

  it("yalnız kiracı koşullu yazma politikası ihlaldir", () => {
    expect(findUnguardedWritePolicies([row({})])).toHaveLength(1);
    expect(findUnguardedWritePolicies([row({ cmd: "ALL", qual: "(tenant_id = ( SELECT current_tenant_id() AS current_tenant_id))" })])).toHaveLength(1);
    expect(findUnguardedWritePolicies([row({ cmd: "DELETE", qual: "((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (is_system = false))", with_check: null })])).toHaveLength(1);
  });

  it("izin ya da kendi-satır koşulu taşıyan, servis rolüne özel ya da yalnız SELECT politikası temizdir", () => {
    const perm = "((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ( SELECT has_effective_permission('settings'::text, 'edit'::text) AS has_effective_permission))";
    expect(findUnguardedWritePolicies([row({ with_check: perm })])).toEqual([]);
    expect(findUnguardedWritePolicies([row({ with_check: "((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (author_id = ( SELECT auth.uid() AS uid)))" })])).toEqual([]);
    expect(findUnguardedWritePolicies([row({ with_check: "((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (user_id = ( SELECT uid() AS uid)))" })])).toEqual([]);
    expect(findUnguardedWritePolicies([row({ roles: "{service_role}" })])).toEqual([]);
    expect(findUnguardedWritePolicies([row({ cmd: "SELECT", qual: "(tenant_id = ( SELECT current_tenant_id() AS current_tenant_id))", with_check: null })])).toEqual([]);
    // UPDATE: yetki USING'dedir; WITH CHECK'in yalnız kiracıyı koruması yeterli.
    expect(findUnguardedWritePolicies([row({ cmd: "UPDATE", qual: perm, with_check: "(tenant_id = ( SELECT current_tenant_id() AS current_tenant_id))" })])).toEqual([]);
  });

  it("SK10 migration'ı B159 tablolarının yazma politikalarına izin koşulu ekler ve cron tablolarında yazmayı kaldırır", () => {
    const sql = readFileSync(join(ROOT, "supabase/migrations/20261016100100_rls_module_write_policies.sql"), "utf8");
    for (const t of ["agent_badges", "agent_score_snapshots", "automation_logs", "playbook_runs"]) {
      expect(sql).toMatch(new RegExp(`revoke insert, update, delete on public\\.${t} from anon, authenticated;`));
    }
    for (const [table, mod] of [
      ["automations", "settings"],
      ["contract_templates", "settings"],
      ["definitions", "settings"],
      ["message_templates", "settings"],
      ["property_dues", "expenses"],
      ["unit_payments", "projects"],
      ["staff_leaves", "team"],
      ["network_listings", "network"],
    ] as const) {
      expect(sql, table).toMatch(new RegExp(`on public\\.${table}[\\s\\S]{0,260}has_effective_permission\\('${mod}'`));
    }
  });
});

// Tip güvencesi: matris modül/eylem adları geçerli birleşimler (derleme anında).
const _typecheck: Partial<Record<AppModule, AppAction[]>> = DEFAULT_MATRIX.readonly;
void _typecheck;
