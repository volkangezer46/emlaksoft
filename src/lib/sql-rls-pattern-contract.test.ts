import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SÖZLEŞME (PANEL_KARAR_1 U13 / P5): statik SQL/RLS kalıp testi. Saf dosya taraması; DB, mock, ağ YOK.
 * `supabase/migrations` ve `supabase/proposed` altındaki .sql dosyalarında şu kalıpları yakalar:
 *
 *  (a) tenant-only yazma politikası: `for all|update|delete` politikasının USING (veya update/all için WITH CHECK)
 *      ifadesi YALNIZ `tenant_id = current_tenant_id()` ise. Yazma politikaları rol/sahip/izin koşulu taşımalı
 *      (current_profile_role, auth.uid(), has_effective_permission ...). Bkz. güvenlik denetimi 3 #8/#11, P5.
 *  (b) SECURITY DEFINER fonksiyonda `set search_path` yokluğu (aynı ada sonradan `alter function ... set
 *      search_path` yazılmışsa çözülmüş sayılır).
 *  (c) `tenant_id` sütunlu `create table` için hiçbir dosyada `enable row level security` yokluğu.
 *  (d) Tanımlandığı dosyada yalnız service_role'e `grant execute` verilen RPC'de (trigger hariç) hiçbir dosyada
 *      `revoke ... on function ... from public, anon, authenticated` (üçü de) yokluğu. Supabase varsayılan
 *      ayrıcalıkları yeni fonksiyona anon/authenticated için EXECUTE verir; yalnız `from public` yetmez.
 *
 * Kapsam bilerek dar (U13: gerçek Postgres test altyapısı kurulmaz): `execute format('create policy %I ...')`
 * gibi dinamik SQL ihlal olarak taranmaz; `alter policy` ve `pg_policies` döngüleri yalnız istisnanın
 * "sonradan geçersiz kılındı" gerekçesini doğrulamak için okunur. Tespit metin düzeyindedir; rollback
 * dosyaları (kasıtlı eski hal) taranmaz.
 *
 * MEVCUT ihlaller aşağıda GEREKÇELİ BİLİNEN-İSTİSNA listelerindedir (anahtar: dosya :: nesne). Uygulanmış
 * dosyalar forward-only olduğundan yerinde düzeltilemez; düzeltici migration ayrı dosyadır. YENİ ihlal testi
 * kırar. Listede olup artık tespit edilmeyen (bayat) anahtar da testi kırar → liste kendiliğinden daralır.
 * Yeni istisna eklemek yerine politikayı/fonksiyonu düzeltin; istisna yalnız gerekçeyle ve sahibin onayıyla.
 */

const ROOT = process.cwd();
const DIRS = ["supabase/migrations", "supabase/proposed"] as const;

type SqlFile = { rel: string; name: string; code: string };

/** Yorumları (-- ve iç içe /* *\/) atar, tek tırnaklı dizgeleri korur, küçük harfe çevirir. */
function stripComments(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === "-" && d === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      out += " ";
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out.toLowerCase();
}

function loadFiles(): SqlFile[] {
  const files: SqlFile[] = [];
  for (const dir of DIRS) {
    for (const name of readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".sql")).sort()) {
      // Rollback dosyaları kasıtlı olarak eski (zayıf) hali geri kurar; kalıp taraması dışında.
      if (name.endsWith(".rollback.sql")) continue;
      files.push({ rel: `${dir}/${name}`, name, code: stripComments(readFileSync(join(ROOT, dir, name), "utf8")) });
    }
  }
  return files;
}

/** `start` konumundaki "(" ile dengeli kapanışa kadar olan içeriği döner. */
function balanced(text: string, start: number): string | null {
  if (text[start] !== "(") return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") {
      i++;
      while (i < text.length && !(text[i] === "'" && text[i + 1] !== "'")) i += text[i] === "'" ? 2 : 1;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return text.slice(start + 1, i);
    }
  }
  return null;
}

/** `start`tan itibaren tırnak ve dolar-tırnak dışındaki ilk ";"e kadar; dolar gövdeleri `<body>` ile değiştirilir (yalnız başlık/kuyruk özellikleri: security definer, set search_path, returns). */
function statementFrom(text: string, start: number): { head: string; end: number } {
  let head = "";
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'") {
      let j = i + 1;
      while (j < text.length && !(text[j] === "'" && text[j + 1] !== "'")) j += text[j] === "'" ? 2 : 1;
      head += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "$") {
      const m = /^\$([a-z_][a-z0-9_]*)?\$/.exec(text.slice(i, i + 64));
      if (m) {
        const close = text.indexOf(m[0], i + m[0].length);
        if (close < 0) return { head, end: text.length };
        head += " <body> ";
        i = close + m[0].length;
        continue;
      }
    }
    if (ch === ";") return { head, end: i };
    head += ch;
    i++;
  }
  return { head, end: text.length };
}

const bareName = (raw: string) => raw.replace(/"/g, "").replace(/^public\./, "");

// ---------------------------------------------------------------------------------------------------------
// (a) tenant-only yazma politikası
// ---------------------------------------------------------------------------------------------------------

function isTenantOnly(expr: string | null): boolean {
  if (expr == null) return false;
  const n = expr
    .replace(/::\s*[a-z_]+/g, "")
    .replace(/\bselect\b/g, "")
    .replace(/\bpublic\./g, "")
    .replace(/[()\s"]/g, "");
  return (
    /^([a-z_]+\.)?tenant_id=(current_tenant_id|current_active_tenant_id)$/.test(n) ||
    /^(current_tenant_id|current_active_tenant_id)=([a-z_]+\.)?tenant_id$/.test(n)
  );
}

type PolicyDef = {
  key: string;
  file: string;
  table: string;
  policy: string;
  cmd: string;
  serviceOnly: boolean;
  using: string | null;
  check: string | null;
};

function splitPolicyBody(rest: string) {
  const usingAt = rest.search(/\busing\s*\(/);
  const checkAt = rest.search(/\bwith\s+check\s*\(/);
  const headEnd = Math.min(...[usingAt, checkAt, rest.length].filter((x) => x >= 0));
  return {
    head: rest.slice(0, headEnd),
    using: usingAt >= 0 ? balanced(rest, rest.indexOf("(", usingAt)) : null,
    check: checkAt >= 0 ? balanced(rest, rest.indexOf("(", checkAt)) : null,
  };
}

const POLICY_TARGET = String.raw`("[^"]+"|[^\s]+)\s+on\s+("[^"]+"\."[^"]+"|"[^"]+"|[a-z0-9_."]+)`;
const isDynamic = (...parts: string[]) => parts.some((p) => /[%'|]/.test(p));

function policyDefs(file: SqlFile): PolicyDef[] {
  const out: PolicyDef[] = [];
  for (const m of file.code.matchAll(new RegExp(String.raw`create\s+policy\s+${POLICY_TARGET}([\s\S]*?);`, "g"))) {
    if (isDynamic(m[1], m[2])) continue; // execute format('create policy %I ...'): kapsam dışı
    const policy = m[1].replace(/"/g, "");
    const table = bareName(m[2]);
    const { head, using, check } = splitPolicyBody(m[3]);
    const roles = /\bto\s+([a-z_,\s]+)$/.exec(head.trim())?.[1].split(",").map((r) => r.trim()) ?? [];
    out.push({
      key: `${file.rel} :: ${table}.${policy}`,
      file: file.rel,
      table,
      policy,
      cmd: /\bfor\s+(all|select|insert|update|delete)\b/.exec(head)?.[1] ?? "all",
      serviceOnly: roles.length > 0 && roles.every((r) => r === "service_role"),
      using,
      check,
    });
  }
  return out;
}

function isTenantOnlyWrite(p: PolicyDef): boolean {
  if (p.serviceOnly || p.cmd === "select" || p.cmd === "insert") return false;
  return isTenantOnly(p.using) || (p.cmd !== "delete" && isTenantOnly(p.check));
}

/**
 * Bir politikanın SONRAKİ bir migration dosyasında geçersiz kılındığı dosyalar: aynı ad için `drop policy`,
 * yeniden `create policy`, tenant-only olmayan `alter policy` veya `pg_policies` döngüsüyle tablodaki tüm
 * politikaların düşürülmesi. Yalnız `supabase/migrations` (proposed uygulanmadı) ve yalnız sonraki dosyalar.
 */
function supersededBy(def: PolicyDef, files: SqlFile[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (!f.rel.startsWith("supabase/migrations/") || f.rel <= def.file) continue;
    let hit = false;
    for (const m of f.code.matchAll(new RegExp(String.raw`(drop|create)\s+policy\s+(?:if\s+exists\s+)?${POLICY_TARGET}`, "g"))) {
      if (!isDynamic(m[2], m[3]) && m[2].replace(/"/g, "") === def.policy && bareName(m[3]) === def.table) hit = true;
    }
    for (const m of f.code.matchAll(new RegExp(String.raw`alter\s+policy\s+${POLICY_TARGET}([\s\S]*?);`, "g"))) {
      if (m[1].replace(/"/g, "") !== def.policy || bareName(m[2]) !== def.table) continue;
      const { using, check } = splitPolicyBody(m[3]);
      if ((using ?? check) !== null && !isTenantOnly(using) && !isTenantOnly(check)) hit = true;
    }
    for (const m of f.code.matchAll(/\bdo\s+(\$[a-z_]*\$)([\s\S]*?)\1/g)) {
      const block = m[2];
      if (!block.includes("pg_policies") || !/drop\s+policy/.test(block)) continue;
      const tables = new Set<string>();
      for (const t of block.matchAll(/tablename\s*=\s*'([a-z0-9_]+)'/g)) tables.add(t[1]);
      for (const arr of block.matchAll(/array\s*\[([^\]]*)\]/g)) {
        for (const t of arr[1].matchAll(/'([a-z0-9_]+)'/g)) tables.add(t[1]);
      }
      // values (('tablo', 'modül'), ...) çiftlerinde yalnız ilk öğe tablodur.
      for (const t of block.matchAll(/\(\s*'([a-z0-9_]+)'\s*,\s*'[a-z0-9_]+'\s*\)/g)) tables.add(t[1]);
      if (tables.has(def.table)) hit = true;
    }
    if (hit) out.push(f.rel);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// (b) SECURITY DEFINER + search_path, (d) service_role-only RPC revoke
// ---------------------------------------------------------------------------------------------------------

type FnDef = { name: string; head: string };

function functionDefs(file: SqlFile): FnDef[] {
  const out: FnDef[] = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_."]+)\s*\(/g;
  for (const m of file.code.matchAll(re)) {
    const { head } = statementFrom(file.code, m.index);
    out.push({ name: bareName(m[1]), head });
  }
  return out;
}

function alteredSearchPath(files: SqlFile[]): Set<string> {
  const fixed = new Set<string>();
  for (const f of files) {
    for (const m of f.code.matchAll(/alter\s+function\s+([a-z0-9_."]+)[^;]*?\bset\s+search_path\b/g)) {
      fixed.add(bareName(m[1]));
    }
  }
  return fixed;
}

function definerWithoutSearchPath(file: SqlFile, fixed: Set<string>): string[] {
  const out: string[] = [];
  for (const fn of functionDefs(file)) {
    if (!/\bsecurity\s+definer\b/.test(fn.head)) continue;
    if (/\bset\s+search_path\b/.test(fn.head) || fixed.has(fn.name)) continue;
    out.push(`${file.rel} :: ${fn.name}`);
  }
  return [...new Set(out)];
}

function rolesFor(code: string, verb: "grant" | "revoke", fn: string): Set<string> {
  const roles = new Set<string>();
  const esc = fn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prep = verb === "grant" ? "to" : "from";
  const re = new RegExp(
    `${verb}\\s+(?:all(?:\\s+privileges)?|execute)\\s+on\\s+function\\s+(?:public\\.)?"?${esc}"?\\b[^;]*?\\s${prep}\\s+([^;]+);`,
    "g",
  );
  for (const m of code.matchAll(re)) {
    for (const r of m[1].split(",")) roles.add(r.trim().replace(/\s+cascade$/, ""));
  }
  return roles;
}

/** Grant'lar fonksiyonun tanımlandığı dosyadan; revoke'lar tüm dosyalardan (sonraki düzeltici migration sayılır). */
function serviceRoleRpcWithoutRevoke(file: SqlFile, files: SqlFile[]): string[] {
  const out: string[] = [];
  for (const fn of functionDefs(file)) {
    if (/\breturns\s+trigger\b/.test(fn.head)) continue;
    const granted = rolesFor(file.code, "grant", fn.name);
    if (!granted.has("service_role")) continue;
    if (granted.has("authenticated") || granted.has("anon") || granted.has("public")) continue;
    const revoked = new Set(files.flatMap((f) => [...rolesFor(f.code, "revoke", fn.name)]));
    if (["public", "anon", "authenticated"].every((r) => revoked.has(r))) continue;
    out.push(`${file.rel} :: ${fn.name}`);
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------------------------------------
// (c) tenant_id'li tablo + RLS
// ---------------------------------------------------------------------------------------------------------

function tenantTables(file: SqlFile): string[] {
  const out: string[] = [];
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_."]+)\s*\(/g;
  for (const m of file.code.matchAll(re)) {
    const name = m[1].replace(/"/g, "");
    if (name.includes(".") && !name.startsWith("public.")) continue; // yalnız public (PostgREST'e açık) şema
    const body = balanced(file.code, m.index + m[0].length - 1);
    if (body && /(^|,)\s*tenant_id\s+uuid\b/.test(body)) out.push(bareName(name));
  }
  return out;
}

function rlsEnabled(files: SqlFile[], table: string): boolean {
  const esc = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const direct = new RegExp(
    `alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(?:public\\.)?"?${esc}"?\\s+enable\\s+row\\s+level\\s+security`,
  );
  return files.some(
    (f) =>
      direct.test(f.code) ||
      // Döngüyle (format('alter table public.%I enable row level security', t)) etkinleştirilen tablo listeleri.
      (/%i\s+enable\s+row\s+level\s+security/.test(f.code) && f.code.includes(`'${table}'`)),
  );
}

// ---------------------------------------------------------------------------------------------------------
// BİLİNEN İSTİSNALAR (gerekçeli). Anahtar biçimi tespitle birebir aynıdır.
// ---------------------------------------------------------------------------------------------------------

type Known = { durum: "dusuruldu" | "duzeltici" | "etkin" | "trigger"; dosya?: string; neden: string };

const LAST_APPLIED = "20260813000300"; // docs/HAFIZA.md §2: canlıda uygulanan son migration

/** Uygulanmış dosyadaki politika sonraki uygulanmış bir migration'da düşürüldü/yeniden kuruldu. */
const dropped = (by: string): Known => ({
  durum: "dusuruldu",
  dosya: by,
  neden: `uygulanmış; ${by} ile düşürüldü/yeniden kuruldu (canlıda etkin değil). Forward-only, dosyaya dokunulmaz.`,
});
/** Uygulanmamış düzeltici migration politikayı daraltır; ana dosyayla AYNI pencerede uygulanmalı. */
const fixer = (by: string): Known => ({
  durum: "duzeltici",
  dosya: by,
  neden: `düzeltici ${by} (uygulanmadı) ile daraltılır; ilgili ana dosyayla AYNI pencerede uygulanmalı. Forward-only.`,
});
/** Uygulanmış ve HÂLÂ ETKİN tenant-only yazma politikası: ayrı düzeltici migration planlanmalı. */
const live = (note = ""): Known => ({
  durum: "etkin",
  neden:
    `uygulanmış (<= ${LAST_APPLIED}), forward-only; HÂLÂ ETKİN tenant-only yazma (20260813000100 initplan ` +
    `sarmasında da tenant-only kaldı). Ayrı düzeltici migration planlanmalı (P5 raporu).${note ? ` ${note}` : ""}`,
});
/** WITH CHECK tenant-only ama aynı dosyadaki BEFORE UPDATE trigger'ı sütun/durum kurallarını uygular. */
const trigger = (fn: string, note: string): Known => ({ durum: "trigger", dosya: fn, neden: note });

// Mahalle notu tablo adı parçalı yazılır: neighborhood-notes/privacy-contract.test.ts tablo adının düz metni
// yalnız izinli ofis içi dosyalarda geçsin diye src/ altını tarar (bu test SQL dosya adını yalnız anahtar olarak kullanır).
const NN = ["neighborhood", "notes"].join("_");

const KNOWN_TENANT_ONLY_WRITE: Record<string, Known> = {
  "supabase/migrations/20260721000000_init.sql :: branches.branches_tenant": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260721000000_init.sql :: profiles.profiles_tenant": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260721000000_init.sql :: customers.customers_tenant": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260721000000_init.sql :: customer_demands.demands_tenant": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260721000000_init.sql :: properties.properties_tenant": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260721000000_init.sql :: portal_listings.portal_listings_tenant": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260721000000_init.sql :: listing_closures.closures_tenant": dropped("20260813000000_core_workflow_invariants"),
  "supabase/migrations/20260721000000_init.sql :: deals.deals_tenant": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260721000000_init.sql :: commissions.commissions_tenant": dropped("20260722000016_rls_role_aware"),
  "supabase/migrations/20260721000000_init.sql :: calls.calls_tenant": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260721000004_appointments.sql :: appointments.appointments_tenant": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260722000008_workflow_extras.sql :: payment_links.payment_links_tenant": dropped("20260722000016_rls_role_aware"),
  "supabase/migrations/20260722000008_workflow_extras.sql :: share_links.share_links_tenant": dropped("20260803000020_capability_tenant_boundary"),
  "supabase/migrations/20260722000008_workflow_extras.sql :: valuations.valuations_tenant": dropped("20260803000020_capability_tenant_boundary"),
  "supabase/migrations/20260722000008_workflow_extras.sql :: iys_consents.iys_consents_tenant": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260723000028_campaigns.sql :: campaigns.campaigns_tenant": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260723000028_campaigns.sql :: campaigns.campaigns_tenant_update": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260723000029_contracts.sql :: contracts.contracts_tenant": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260723000029_contracts.sql :: contracts.contracts_tenant_update": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260723000030_customer_portal.sql :: customer_portal_tokens.customer_portal_tokens_tenant": dropped("20260803000020_capability_tenant_boundary"),
  "supabase/migrations/20260723000031_features_6to10.sql :: expenses.expenses_tenant": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260723000031_features_6to10.sql :: expenses.expenses_tenant_update": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260723000031_features_6to10.sql :: offers.offers_tenant": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260723000031_features_6to10.sql :: offers.offers_tenant_update": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260723000031_features_6to10.sql :: targets.targets_tenant": dropped("20260813000000_core_workflow_invariants"),
  "supabase/migrations/20260723000031_features_6to10.sql :: targets.targets_tenant_update": dropped("20260813000000_core_workflow_invariants"),
  "supabase/migrations/20260723000031_features_6to10.sql :: open_houses.open_houses_tenant": dropped("20260803000020_capability_tenant_boundary"),
  "supabase/migrations/20260723000032_communications.sql :: communications.communications_tenant": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260723000032_communications.sql :: communications.communications_update": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260723000033_owner_portal.sql :: owner_portal_tokens.owner_portal_tokens_tenant": dropped("20260803000020_capability_tenant_boundary"),
  "supabase/migrations/20260723000034_property_history_auth_lookup.sql :: property_status_history.prop_status_history_tenant": dropped("20260813000000_core_workflow_invariants"),
  "supabase/migrations/20260723000036_automations_efatura.sql :: automations.automations_tenant": live(),
  "supabase/migrations/20260723000036_automations_efatura.sql :: automations.automations_update": live(),
  "supabase/migrations/20260723000036_automations_efatura.sql :: automation_logs.automation_logs_tenant": live(),
  "supabase/migrations/20260724000039_property_dues.sql :: property_dues.property_dues_tenant": live(),
  "supabase/migrations/20260724000039_property_dues.sql :: property_dues.property_dues_tenant_update": live(),
  "supabase/migrations/20260725000042_definitions.sql :: definitions.definitions_update": live(),
  "supabase/migrations/20260725000042_definitions.sql :: definitions.definitions_delete": live(),
  "supabase/migrations/20260725000049_property_price_history.sql :: property_price_history.pph_tenant": live(
    "Fiyat değişim izi herhangi bir üyece silinebilir/değiştirilebilir; bkz. GUVENLIK_DENETIMI_3 Ek.",
  ),
  "supabase/migrations/20260725000054_rls_tenant_helper_drift.sql :: tasks.tasks_tenant": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260725000054_rls_tenant_helper_drift.sql :: property_media.property_media_tenant": dropped("20260802000420_customer_document_security_boundary"),
  "supabase/migrations/20260726000060_tenant_integrations.sql :: tenant_integrations.tenant_integrations_update": dropped("20260726000077_hardening"),
  "supabase/migrations/20260726000060_tenant_integrations.sql :: tenant_integrations.tenant_integrations_delete": dropped("20260726000077_hardening"),
  "supabase/migrations/20260726000063_offer_rounds.sql :: offer_rounds.offer_rounds_tenant": dropped("20260813000000_core_workflow_invariants"),
  "supabase/migrations/20260726000064_lost_sale_snooze.sql :: lost_sale_dismissals.lsd_tenant": live(),
  "supabase/migrations/20260726000069_deal_costs.sql :: deal_costs.deal_costs_tenant": dropped("20260813000000_core_workflow_invariants"),
  "supabase/migrations/20260726000070_contract_templates_versions.sql :: contract_templates.contract_templates_update": live(),
  "supabase/migrations/20260726000070_contract_templates_versions.sql :: contract_templates.contract_templates_delete": live(),
  "supabase/migrations/20260726000074_rentals_module.sql :: rentals.rentals_tenant": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260726000074_rentals_module.sql :: rent_charges.rent_charges_tenant": dropped("20260813000000_core_workflow_invariants"),
  "supabase/migrations/20260726000074_rentals_module.sql :: maintenance_requests.maintenance_requests_tenant": dropped("20260813000000_core_workflow_invariants"),
  "supabase/migrations/20260726000075_projects_module.sql :: projects.projects_tenant": dropped("20260802000300_identity_session_authorization_hardening"),
  "supabase/migrations/20260726000075_projects_module.sql :: project_units.project_units_tenant": dropped("20260813000000_core_workflow_invariants"),
  "supabase/migrations/20260726000079_network_module.sql :: network_listings.network_listings_tenant": live(),
  "supabase/migrations/20260726000083_unit_payments.sql :: unit_payments.unit_payments_tenant": live(),
  "supabase/migrations/20260726000084_network_demands.sql :: network_demands.network_demands_tenant": live(),
  "supabase/migrations/20260726000100_presentations.sql :: presentations.presentations_tenant": live(),
  "supabase/migrations/20260727000103_deal_checklist.sql :: deal_checklist_items.deal_checklist_tenant_update": dropped("20260813000000_core_workflow_invariants"),
  "supabase/migrations/20260727000103_deal_checklist.sql :: deal_checklist_items.deal_checklist_tenant_delete": dropped("20260813000000_core_workflow_invariants"),
  "supabase/migrations/20260727000104_surveys.sql :: surveys.surveys_tenant": dropped("20260803000020_capability_tenant_boundary"),
  "supabase/migrations/20260727000106_announcements.sql :: announcements.announcements_tenant_update": live(),
  "supabase/migrations/20260727000106_announcements.sql :: announcements.announcements_tenant_delete": live(),
  "supabase/migrations/20260727000107_customer_files_rls_fix.sql :: customer_files.customer_files_tenant": dropped("20260802000420_customer_document_security_boundary"),
  "supabase/migrations/20260727000108_property_keys.sql :: property_keys.property_keys_tenant_update": live(),
  "supabase/migrations/20260727000108_property_keys.sql :: property_keys.property_keys_tenant_delete": live(),
  "supabase/migrations/20260727000108_property_keys.sql :: property_key_events.property_key_events_tenant_delete": live(),
  "supabase/migrations/20260727000109_booking_settings.sql :: booking_settings.booking_settings_tenant": dropped("20260803000020_capability_tenant_boundary"),
  "supabase/migrations/20260727000111_referrals.sql :: referral_links.referral_links_tenant": dropped("20260803000020_capability_tenant_boundary"),
  "supabase/migrations/20260727000111_referrals.sql :: referrals.referrals_tenant": dropped("20260803000020_capability_tenant_boundary"),
  "supabase/migrations/20260727000114_message_templates.sql :: message_templates.message_templates_tenant_update": live(),
  "supabase/migrations/20260727000114_message_templates.sql :: message_templates.message_templates_tenant_delete": live(),
  "supabase/migrations/20260727000115_playbooks.sql :: playbooks.playbooks_tenant": live(),
  "supabase/migrations/20260727000115_playbooks.sql :: playbook_steps.playbook_steps_tenant": live(),
  "supabase/migrations/20260727000115_playbooks.sql :: playbook_runs.playbook_runs_tenant": live(),
  "supabase/migrations/20260727000117_staff_leaves.sql :: staff_leaves.staff_leaves_tenant": live(),
  "supabase/migrations/20260728000120_gamification.sql :: agent_badges.agent_badges_tenant": live(),
  "supabase/migrations/20260728000120_gamification.sql :: agent_score_snapshots.agent_score_snapshots_tenant": live(),
  "supabase/migrations/20260728000123_approval_requests.sql :: approval_requests.approval_requests_tenant": fixer("20260823000100_sec3_approval_requests_rls"),
  "supabase/migrations/20260728000123_approval_requests.sql :: approval_comments.approval_comments_tenant": live(),
  "supabase/migrations/20260819010600_k5_kvkk_requests.sql :: kvkk_requests.kvkk_requests_tenant_update": fixer("20260823000300_sec3_kvkk_requests_role_guard"),
  "supabase/migrations/20260819020100_property_owner_info.sql :: property_owner_info.property_owner_info_update": fixer("20260823000400_sec3_property_owner_info_update_scope"),
  [`supabase/migrations/20260821000100_${NN}.sql :: ${NN}.${NN}_tenant_update`]: fixer(`20260824001100_p5_${NN}_owner_scope`),
  [`supabase/migrations/20260821000100_${NN}.sql :: ${NN}.${NN}_tenant_delete`]: fixer(`20260824001100_p5_${NN}_owner_scope`),
  "supabase/migrations/20260821000300_document_requests.sql :: document_requests.document_requests_tenant_update": fixer("20260824001200_p5_document_requests_write_scope"),
  "supabase/migrations/20260823000100_sec3_approval_requests_rls.sql :: approval_requests.approval_requests_update": trigger(
    "guard_approval_request_update",
    "uygulanmadı; WITH CHECK yalnız tenant ama USING sahip/karar kademesi ve sütun/durum kuralları aynı dosyadaki BEFORE UPDATE trigger'ında (sec3 #1).",
  ),
};

// (b), (c), (d): bu dosya yazıldığında mevcut ihlal YOK (d'deki iki RPC 20260824001300 ile kapatıldı). Boş kalmalı.
const KNOWN_DEFINER_NO_SEARCH_PATH: Record<string, string> = {};
const KNOWN_TABLE_NO_RLS: Record<string, string> = {};
const KNOWN_SERVICE_RPC_NO_REVOKE: Record<string, string> = {};

function diff(found: string[], known: Record<string, unknown>) {
  const set = new Set(found);
  return {
    fresh: found.filter((k) => !(k in known)).sort(),
    stale: Object.keys(known).filter((k) => !set.has(k)).sort(),
  };
}

const files = loadFiles();
const policies = files.flatMap(policyDefs);
const shortName = (rel: string) => rel.replace(/^supabase\/migrations\//, "").replace(/\.sql$/, "");

// Tam paket koşusunda dosya taraması yavaşlayabilir; varsayılan 5 sn yerine geniş süre.
describe("statik SQL/RLS kalıp sözleşmesi (U13/P5)", { timeout: 60_000 }, () => {
  it("tarayıcılar gerçekten nesne buluyor (regex sessizce körleşmesin)", () => {
    expect(files.filter((f) => f.rel.startsWith("supabase/migrations/")).length).toBeGreaterThan(100);
    expect(policies.length).toBeGreaterThan(300);
    const fns = files.flatMap(functionDefs);
    expect(fns.filter((f) => /\bsecurity\s+definer\b/.test(f.head)).length).toBeGreaterThan(100);
    expect(files.flatMap(tenantTables).length).toBeGreaterThan(100);
    // Dedektörün kendisi: bilinen kötü ve iyi örnekler.
    expect(isTenantOnly("tenant_id = (select public.current_tenant_id())")).toBe(true);
    expect(isTenantOnly("((tenant_id = ( select public.current_active_tenant_id())))")).toBe(true);
    expect(isTenantOnly("tenant_id = public.current_tenant_id() and created_by = auth.uid()")).toBe(false);
  });

  it("(a) yeni tenant-only for all/update/delete politikası yok", () => {
    const { fresh, stale } = diff(policies.filter(isTenantOnlyWrite).map((d) => d.key), KNOWN_TENANT_ONLY_WRITE);
    expect({ yeniIhlal: fresh, bayatIstisna: stale }).toEqual({ yeniIhlal: [], bayatIstisna: [] });
  });

  it("(a) istisna gerekçeleri doğru: düşürüldü/düzeltici gerçekten geçersiz kılıyor, etkin olanlar gerçekten etkin", () => {
    const wrong: string[] = [];
    for (const def of policies.filter(isTenantOnlyWrite)) {
      const k = KNOWN_TENANT_ONLY_WRITE[def.key];
      if (!k) continue;
      const by = supersededBy(def, files).map(shortName);
      const applied = (k.dosya ?? "").slice(0, 14) <= LAST_APPLIED;
      if (k.durum === "dusuruldu" && !(k.dosya && by.includes(k.dosya) && applied)) wrong.push(def.key);
      if (k.durum === "duzeltici" && !(k.dosya && by.includes(k.dosya) && !applied)) wrong.push(def.key);
      if ((k.durum === "etkin" || k.durum === "trigger") && by.length > 0) {
        wrong.push(`${def.key} (artık geçersiz kılınmış: ${by.join(", ")})`);
      }
      if (k.durum === "trigger") {
        const code = files.find((f) => f.rel === def.file)?.code ?? "";
        const re = new RegExp(String.raw`create\s+trigger[\s\S]*?execute\s+function\s+public\.${k.dosya}\(`);
        if (!re.test(code)) wrong.push(`${def.key} (trigger ${k.dosya} aynı dosyada yok)`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("(a) istisna sayıları (rapor): etkin eski politika listesi yalnız düzeltici migration ile küçülür", () => {
    const count = (d: Known["durum"]) => Object.values(KNOWN_TENANT_ONLY_WRITE).filter((k) => k.durum === d).length;
    expect({
      toplam: Object.keys(KNOWN_TENANT_ONLY_WRITE).length,
      dusuruldu: count("dusuruldu"),
      duzeltici: count("duzeltici"),
      etkin: count("etkin"),
      trigger: count("trigger"),
    }).toEqual({ toplam: 85, dusuruldu: 49, duzeltici: 6, etkin: 29, trigger: 1 });
  });

  it("(b) yeni SECURITY DEFINER fonksiyonu set search_path taşıyor", () => {
    const fixed = alteredSearchPath(files);
    const found = files.flatMap((f) => definerWithoutSearchPath(f, fixed));
    const { fresh, stale } = diff(found, KNOWN_DEFINER_NO_SEARCH_PATH);
    expect({ yeniIhlal: fresh, bayatIstisna: stale }).toEqual({ yeniIhlal: [], bayatIstisna: [] });
  });

  it("(c) tenant_id'li her yeni tabloda RLS etkin", () => {
    const found = files.flatMap((f) =>
      tenantTables(f)
        .filter((t) => !rlsEnabled(files, t))
        .map((t) => `${f.rel} :: ${t}`),
    );
    const { fresh, stale } = diff([...new Set(found)], KNOWN_TABLE_NO_RLS);
    expect({ yeniIhlal: fresh, bayatIstisna: stale }).toEqual({ yeniIhlal: [], bayatIstisna: [] });
  });

  it("EmlakFiyati kontör kümesi (20260826000100..000300): yalnız SELECT politikası (tenant-only DEĞİL), definer + search_path, revoke, RLS", () => {
    const ef = files.filter((f) => /^supabase\/migrations\/20260826000[123]00_ef_/.test(f.rel));
    expect(ef.map((f) => f.name)).toEqual([
      "20260826000100_ef_credit_wallet.sql",
      "20260826000200_ef_reports.sql",
      "20260826000300_ef_credit_pack_fulfillment.sql",
    ]);
    const efPolicies = ef.flatMap(policyDefs);
    expect(efPolicies.map((p) => `${p.table}.${p.policy}:${p.cmd}`).sort()).toEqual([
      "ef_credit_reservations.ef_credit_reservations_select:select",
      "ef_reports.ef_reports_select:select",
    ]);
    // SELECT de olsa yalnız tenant koşulu yetmez: kendi kaydı ya da owner/gm.
    for (const p of efPolicies) {
      expect(isTenantOnly(p.using), p.key).toBe(false);
      expect(p.using ?? "", p.key).toMatch(/auth\.uid\(\)/);
      expect(p.using ?? "", p.key).toMatch(/current_profile_role\(\)\s*\)\s*in\s*\('owner',\s*'gm'\)/);
    }
    const fixed = alteredSearchPath(files);
    expect(ef.flatMap((f) => definerWithoutSearchPath(f, fixed))).toEqual([]);
    expect(ef.flatMap((f) => serviceRoleRpcWithoutRevoke(f, files))).toEqual([]);
    const definers = ef.flatMap(functionDefs).filter((f) => /\bsecurity\s+definer\b/.test(f.head)).map((f) => f.name);
    expect(definers.sort()).toEqual([
      "ef_credit_balance", "ef_credit_commit", "ef_credit_grant", "ef_credit_ready", "ef_credit_release", "ef_credit_reserve",
      "ef_credit_sweep", "fulfill_billing_payment", "fulfill_billing_payment_v2",
    ]);
    const tables = ef.flatMap(tenantTables);
    expect(tables.sort()).toEqual(["ef_credit_reservations", "ef_reports"]);
    for (const t of tables) expect(rlsEnabled(files, t), t).toBe(true);
  });

  it("(d) yalnız service_role'e açık yeni RPC public/anon/authenticated'dan revoke ediliyor", () => {
    const found = files.flatMap((f) => serviceRoleRpcWithoutRevoke(f, files));
    const { fresh, stale } = diff(found, KNOWN_SERVICE_RPC_NO_REVOKE);
    expect({ yeniIhlal: fresh, bayatIstisna: stale }).toEqual({ yeniIhlal: [], bayatIstisna: [] });
  });
});
