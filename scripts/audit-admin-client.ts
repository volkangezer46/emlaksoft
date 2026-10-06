/**
 * createAdminClient (service_role, RLS'i atlar) statik denetimi.
 *
 * Yalnız kaynak dosyaları OKUR (src/**). DB'ye bağlanmaz, ağ kullanmaz.
 * Her createAdminClient() çağrısını içeren üst düzey işlevi ("birim") bulur ve
 * şunları sınıflandırır:
 *   - tenantFilter: var | param | yok | devir | uygulanamaz
 *   - gate (çağıran kapısı): oturum-izin | platform | cron | webhook-imza |
 *     public-token | dosya-duzeyi | belirsiz
 *   - risk: P0 | P1 | P2
 *
 * Bu bir HEURİSTİK denetimdir (regex + TS AST). Yanlış-pozitif/negatif üretebilir;
 * "var" sınıfı tenant filtresinin DOĞRULUĞUNU kanıtlamaz, yalnız izinin varlığını gösterir.
 *
 * Kullanım:
 *   npx tsx scripts/audit-admin-client.ts            # insan okur özet
 *   npx tsx scripts/audit-admin-client.ts --json     # JSON
 *   npx tsx scripts/audit-admin-client.ts --write    # docs envanterini + kabul listesini üretir
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export type TenantFilter = "var" | "param" | "yok" | "devir" | "uygulanamaz";
export type GateKind =
  | "oturum-izin"
  | "platform"
  | "cron"
  | "webhook-imza"
  | "public-token"
  | "dosya-duzeyi"
  | "elle-dogrulandi"
  | "belirsiz";
export type Risk = "P0" | "P1" | "P2";

export type AdminUsage = {
  file: string;
  fn: string;
  line: number;
  calls: number;
  tenantFilter: TenantFilter;
  gate: GateKind;
  gateEvidence: string;
  mutates: boolean;
  usesAuthAdmin: boolean;
  usesStorage: boolean;
  risk: Risk;
  reason: string;
  migratable: boolean;
};

const SKIP_FILE = /(\.test\.tsx?|\.d\.ts)$/;
const ADMIN_FACTORY_FILE = "src/lib/supabase/admin.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !SKIP_FILE.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function stmtName(stmt: ts.Statement): string {
  if (ts.isFunctionDeclaration(stmt) && stmt.name) return stmt.name.text;
  if (ts.isVariableStatement(stmt)) {
    const d = stmt.declarationList.declarations[0];
    if (d && ts.isIdentifier(d.name)) return d.name.text;
  }
  if (ts.isClassDeclaration(stmt) && stmt.name) return stmt.name.text;
  return "<modul-duzeyi>";
}

const GATE_PATTERNS: Array<{ kind: GateKind; re: RegExp }> = [
  { kind: "oturum-izin", re: /\b(requirePermission|requireActiveTenant|requireManager|requireModulePage|authorizeTicketAttachmentAccess|authorizeStoredTicketAttachment)\s*\(/ },
  { kind: "platform", re: /\b(requirePlatformModule|requirePlatformStaff|getPlatformStaff|platformCanAccess)\s*\(/ },
  { kind: "cron", re: /CRON_SECRET|authorized\(\s*request|recordHeartbeat/ },
  { kind: "webhook-imza", re: /\b(verifyMetaSignature|verifyWebhookSignatureV3|verifyCheckoutPayment|verifyCheckoutRetrieveResponseSignature)\s*\(|x-hub-signature/i },
  { kind: "public-token", re: /\b(token|portal_token|share_token|public_token|verifyOtpHash|verifySignatureOtp|verifyShortLivedPropertyMediaClaim)\b/i },
];

/**
 * ELLE İNCELENEN birimler: kaynak okunarak kapının varlığı teyit edildi (otomatik
 * tarayıcı bu kapıyı göremiyor). Kanıt metni zorunlu; kod değişirse bu girdiler
 * yeniden gözden geçirilmeli. Buraya yalnız GERÇEKTEN okunmuş kayıt eklenir.
 */
const MANUAL_REVIEW: Record<string, { tenantFilter?: TenantFilter; evidence: string }> = {
  "src/app/actions/team.ts::createTeamMember": {
    tenantFilter: "var",
    evidence:
      "admin istemcisi src/lib/team/provision-member.ts provisionTeamMember'a verilir; tenantId kapıdan (requireManager) gelir, şube/koltuk sorguları .eq(\"tenant_id\", tenantId), profil insert tenant_id: input.tenantId",
  },
  "src/app/api/health/route.ts::GET": {
    tenantFilter: "uygulanamaz",
    evidence: "route.ts:51 detailedHealthAuthorized (HEALTHCHECK_SECRET Bearer); yalnız tenants(id) limit 1 ve schema_migrations okur",
  },
  "src/lib/direct-file-upload-server.ts::updateOwnedLease": {
    evidence: "yalnız finalizeDirectFileUpload akışından (contextIsValid, claim_direct_file_upload p_tenant_id) çağrılır; id+lease_id (uuid) ile güncelleme",
  },
  "src/lib/admin-badges.ts::cachedBadges": {
    tenantFilter: "uygulanamaz",
    evidence: "tek çağıran getAdminBadges <- src/app/admin/layout.tsx:15 (requirePlatformStaff); platform geneli sayaç",
  },
  "src/lib/rate-limit.ts::checkRateLimit": {
    tenantFilter: "uygulanamaz",
    evidence: "check_rate_limit RPC'si IP/anahtar sayacı; tenant verisi okumaz/yazmaz (RPC gövdesi doğrulanmadı)",
  },
  "src/lib/webhooks/meta-inbound.ts::claimEvent": {
    evidence: "yalnız ingestMeta* <- src/app/api/webhooks/meta/route.ts:81 verifyMetaSignature",
  },
  "src/lib/webhooks/netgsm-inbound.ts::claimEvent": {
    evidence: "yalnız ingestNetgsmInbound <- src/app/api/webhooks/netgsm-sms/route.ts:92 NETGSM_WEBHOOK_SECRET eşleşmesi",
  },
  "src/lib/seo/store.ts::logNotFound": {
    tenantFilter: "uygulanamaz",
    evidence: "yalnız src/app/[...slug]/page.tsx (herkese açık 404 yolu) çağırır; seo_log_404 RPC'si tenant verisi okumaz/yazmaz, yalnız yol sayacı (IP/sorgu yok); migration 20260816001790",
  },
  "src/lib/seo/store.ts::prune404": {
    tenantFilter: "uygulanamaz",
    evidence: "tek çağıran src/lib/seo/robot.ts executeSeoRobot <- api/cron/seo-robot (CRON_SECRET) ve runSeoRobotNow (requirePlatformModule seo + süper admin); yalnız seo_404_hits temizliği, tenant verisi yok",
  },
  "src/lib/geo-province-sync.ts::failClaimedJob": {
    tenantFilter: "uygulanamaz",
    evidence: "yalnız runGeoProvinceSyncWorker <- api/cron/geo-province-sync (CRON_SECRET dosya düzeyi çıkarım); global il/ilçe iş kuyruğu (RPC gövdesi doğrulanmadı)",
  },
  "src/lib/geo-province-sync.ts::runGeoProvinceSyncWorker": {
    tenantFilter: "uygulanamaz",
    evidence: "tek çağıran src/app/api/cron/geo-province-sync/route.ts; global il/ilçe iş kuyruğu (RPC gövdesi doğrulanmadı)",
  },
  "src/app/actions/auth.ts::signUp": {
    evidence: "herkese açık kayıt akışı BİLİNÇLİ kapısız: auth.admin.createUser + provision_registration RPC ile yeni tenant yaratır (mevcut tenant verisine dokunmaz; rate-limit varlığı doğrulanmadı)",
  },
  "src/lib/billing/reconciliation.ts::transitionCapture": {
    evidence: "yalnız reconcileCapture <- runBillingReconciliation <- api/cron/billing-reconciliation (CRON_SECRET; dosya düzeyi çıkarım)",
  },
};

let ADMIN_LAYOUT_GATED = false;

function detectGate(
  unitText: string,
  fileText: string,
  file: string,
): { gate: GateKind; evidence: string } {
  // 1) Birimin kendi gövdesinde kapı var mı?
  for (const g of GATE_PATTERNS) {
    if (g.kind === "public-token") continue; // en zayıf; aşağıda yol ile birlikte
    const m = unitText.match(g.re);
    if (m) return { gate: g.kind, evidence: `işlev içinde: ${m[0].trim()}` };
  }
  // Token bir SEÇİCİ olarak kullanılıyorsa (eşleşen satır yoksa sonuç yok) kapı budur.
  const tokenSel = unitText.match(
    /\.eq\(\s*["'`][a-z_]*token["'`]|\bp_(?!lease)[a-z_]*token\b|\bverifyShortLived\w*\s*\(/i,
  );
  if (tokenSel) {
    return { gate: "public-token", evidence: `token seçici/parametre: ${tokenSel[0]} (token üretimi/süresi doğrulanmadı)` };
  }
  if (/^src\/app\/admin\//.test(file) && !/\/route\.ts$/.test(file) && ADMIN_LAYOUT_GATED) {
    return { gate: "platform", evidence: "src/app/admin/layout.tsx requirePlatformStaff (dosya yolu ile çıkarım)" };
  }
  if (/\/api\/cron\//.test(file)) {
    return { gate: "cron", evidence: "yol: api/cron (CRON_SECRET doğrulaması dosya düzeyinde doğrulanmadı)" };
  }
  // public-token: yalnız herkese açık yüzeylerde ve token geçiyorsa
  const publicSurface = /\/(vitrin|portal|davet|imza|p|public|api\/public|api\/webhooks?)\b|\/giris\//.test(file);
  if (publicSurface && GATE_PATTERNS[4].re.test(unitText)) {
    return { gate: "public-token", evidence: "herkese açık yüzey + token/OTP geçiyor (doğrulama mantığı elle incelenmeli)" };
  }
  // 2) Dosyanın başka bir yerinde kapı var mı? (zayıf kanıt)
  for (const g of GATE_PATTERNS) {
    if (g.kind === "public-token") continue;
    const m = fileText.match(g.re);
    if (m) return { gate: "dosya-duzeyi", evidence: `dosyada başka yerde: ${m[0].trim()} (bu işlevin kapısı olduğu doğrulanmadı)` };
  }
  return { gate: "belirsiz", evidence: "kapı bulunamadı; çağıranlar elle doğrulanmalı" };
}

/**
 * supabase/migrations içinde tenant_id sütunu OLMAYAN tabloları bulur (heuristik:
 * create table gövdesinde veya alter table ... add column tenant_id aramasında).
 */
export function loadGlobalTables(root: string): Set<string> {
  const dir = join(root, "supabase", "migrations");
  const created = new Map<string, boolean>();
  let sqlAll = "";
  try {
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
      const sql = readFileSync(join(dir, f), "utf8");
      sqlAll += "\n" + sql;
      const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s*\(/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sql))) {
        let depth = 1;
        let i = re.lastIndex;
        while (i < sql.length && depth > 0) {
          if (sql[i] === "(") depth++;
          else if (sql[i] === ")") depth--;
          i++;
        }
        const has = /tenant_id/i.test(sql.slice(re.lastIndex, i));
        created.set(m[1], has || created.get(m[1]) === true);
      }
    }
  } catch {
    return new Set();
  }
  const globals = new Set<string>();
  for (const [t, has] of created) {
    const added = new RegExp(
      "alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(?:public\\.)?" + t + "\\s+add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?tenant_id",
      "i",
    ).test(sqlAll);
    if (!has && !added) globals.add(t);
  }
  return globals;
}

let GLOBAL_TABLES = new Set<string>();

function detectTenantFilter(unitText: string): TenantFilter {
  const touchesData = /\.(from|rpc)\s*\(/.test(unitText) || /\.storage\b/.test(unitText);
  const tables = [...unitText.matchAll(/\.from\(\s*["'`]([a-z_0-9]+)["'`]/g)].map((m) => m[1]);
  if (tables.length > 0 && !/\.rpc\s*\(|\.storage\b/.test(unitText) && tables.every((t) => GLOBAL_TABLES.has(t))) {
    return "uygulanamaz"; // yalnız tenant_id sütunu olmayan (global) tablolar
  }
  if (!touchesData) {
    return /\.auth\.admin\b/.test(unitText) ? "uygulanamaz" : /\badmin\b\s*[,)]/.test(unitText) ? "devir" : "uygulanamaz";
  }
  if (/tenant_id/.test(unitText)) return "var";
  if (/\btenantId\b|\btenant\.id\b|\bctx\.tenant/.test(unitText)) return "param";
  // admin istemcisi başka bir işleve veriliyorsa filtre orada olabilir (doğrulanmadı)
  if (/\(\s*admin\s*[,)]|,\s*admin\s*[,)]/.test(unitText)) return "devir";
  return "yok";
}

function classify(u: Omit<AdminUsage, "risk" | "reason" | "migratable">): {
  risk: Risk;
  reason: string;
  migratable: boolean;
} {
  const unfiltered = u.tenantFilter === "yok" || u.tenantFilter === "devir";
  const weakGate = u.gate === "belirsiz" || u.gate === "dosya-duzeyi";
  let reason: string;
  switch (u.gate) {
    case "cron": reason = "Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır."; break;
    case "platform": reason = "Platform personeli: kiracılar arası yönetim paneli."; break;
    case "webhook-imza": reason = "Oturumsuz dış çağrı (webhook/ödeme geri dönüşü)."; break;
    case "public-token": reason = "Oturumsuz token'lı public yüzey."; break;
    case "oturum-izin": reason = u.usesAuthAdmin
      ? "auth.admin API'si (RLS ile yapılamaz)."
      : "Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı)."; break;
    case "elle-dogrulandi": reason = "Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı)."; break;
    default: reason = "Gerekçe doğrulanmadı."; break;
  }
  const migratable =
    u.gate === "oturum-izin" && !u.usesAuthAdmin && !u.usesStorage && u.tenantFilter !== "uygulanamaz";

  let risk: Risk = "P2";
  if (unfiltered && u.gate === "belirsiz") risk = "P0";
  else if (unfiltered && u.gate === "dosya-duzeyi") risk = "P1";
  else if (unfiltered && (u.gate === "oturum-izin" || u.gate === "public-token") && !u.usesAuthAdmin) risk = "P1";
  else if (u.tenantFilter === "param" && weakGate && u.mutates) risk = "P1";
  else if (u.tenantFilter === "param" && u.gate === "belirsiz") risk = "P1";
  return { risk, reason, migratable };
}

export function scanAdminClientUsage(root: string = process.cwd()): AdminUsage[] {
  const srcDir = join(root, "src");
  GLOBAL_TABLES = loadGlobalTables(root);
  try {
    ADMIN_LAYOUT_GATED = /requirePlatformStaff\s*\(/.test(readFileSync(join(root, "src/app/admin/layout.tsx"), "utf8"));
  } catch {
    ADMIN_LAYOUT_GATED = false;
  }
  const allFiles = walk(srcDir).map((abs) => ({
    rel: relative(root, abs).split("\\").join("/"),
    text: readFileSync(abs, "utf8"),
  }));
  const usages: AdminUsage[] = [];
  for (const abs of walk(srcDir)) {
    const rel = relative(root, abs).split("\\").join("/");
    if (rel === ADMIN_FACTORY_FILE) continue;
    const text = readFileSync(abs, "utf8");
    if (!text.includes("createAdminClient")) continue;
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, abs.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

    const units = new Map<ts.Statement, { calls: number; firstPos: number }>();
    const visit = (node: ts.Node, top: ts.Statement | undefined) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "createAdminClient" &&
        top
      ) {
        const cur = units.get(top);
        if (cur) cur.calls++;
        else units.set(top, { calls: 1, firstPos: node.getStart(sf) });
      }
      ts.forEachChild(node, (c) => visit(c, top));
    };
    for (const stmt of sf.statements) {
      if (ts.isImportDeclaration(stmt)) continue;
      visit(stmt, stmt);
    }

    const nameCount = new Map<string, number>();
    for (const [stmt, info] of units) {
      let fn = stmtName(stmt);
      const n = (nameCount.get(fn) ?? 0) + 1;
      nameCount.set(fn, n);
      if (n > 1) fn = `${fn}#${n}`;
      const unitText = stmt.getText(sf);
      let { gate, evidence } = detectGate(unitText, text, rel);
      if (gate === "belirsiz" && /^[A-Za-z_]\w*$/.test(fn) && !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|default)$/.test(fn)) {
        // Çağıran dosyaların kapısına bak (zayıf kanıt: dosya düzeyi).
        const callRe = new RegExp(`\\b${fn}\\s*\\(`);
        const callers = allFiles.filter((f) => f.rel !== rel && callRe.test(f.text));
        const gated = callers.map((c) => ({ c, g: detectGate(c.text, c.text, c.rel) }));
        if (callers.length > 0 && gated.every((x) => x.g.gate !== "belirsiz")) {
          gate = "dosya-duzeyi";
          evidence = `çağıranlar kapılı (${gated.map((x) => `${x.c.rel}: ${x.g.gate}`).slice(0, 4).join("; ")}); işlevin kendisi kapısız`;
        } else if (callers.length > 0) {
          evidence = `kapısız çağıran: ${gated.filter((x) => x.g.gate === "belirsiz").map((x) => x.c.rel).slice(0, 3).join(", ")}`;
        } else {
          evidence = "kapı bulunamadı; çağıran bulunamadı (çağrı dinamik/yok olabilir, doğrulanmadı)";
        }
      }
      let tenantFilter = detectTenantFilter(unitText);
      const manual = MANUAL_REVIEW[`${rel}::${fn}`];
      if (manual) {
        gate = "elle-dogrulandi";
        evidence = `ELLE İNCELENDİ: ${manual.evidence}`;
        if (manual.tenantFilter) tenantFilter = manual.tenantFilter;
      }
      const base = {
        file: rel,
        fn,
        line: sf.getLineAndCharacterOfPosition(info.firstPos).line + 1,
        calls: info.calls,
        tenantFilter,
        gate,
        gateEvidence: evidence,
        mutates: /\.(insert|update|delete|upsert)\s*\(/.test(unitText),
        usesAuthAdmin: /\.auth\.admin\b/.test(unitText),
        usesStorage: /\.storage\b/.test(unitText),
      };
      usages.push({ ...base, ...classify(base) });
    }
  }
  return usages.sort((a, b) => (a.file + a.fn).localeCompare(b.file + b.fn));
}

const RISK_ORDER: Record<Risk, number> = { P0: 0, P1: 1, P2: 2 };

export function summarize(usages: AdminUsage[]) {
  const count = <K extends string>(f: (u: AdminUsage) => K) => {
    const r: Record<string, number> = {};
    for (const u of usages) r[f(u)] = (r[f(u)] ?? 0) + 1;
    return r;
  };
  return {
    total: usages.length,
    files: new Set(usages.map((u) => u.file)).size,
    risk: count((u) => u.risk),
    tenantFilter: count((u) => u.tenantFilter),
    gate: count((u) => u.gate),
    unfiltered: usages.filter((u) => u.tenantFilter === "yok" || u.tenantFilter === "devir").length,
    migratable: usages.filter((u) => u.migratable).length,
  };
}

function renderMarkdown(usages: AdminUsage[]): string {
  const s = summarize(usages);
  const sorted = [...usages].sort(
    (a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || (a.file + a.fn).localeCompare(b.file + b.fn),
  );
  const row = (u: AdminUsage) =>
    `| \`${u.file}:${u.line}\` | \`${u.fn}\` | ${u.reason} | ${u.gate} | ${u.tenantFilter}${u.mutates ? " (yazma)" : ""} | ${u.risk} |`;
  const head = "| Dosya:satır | İşlev | Neden admin | Kapı türü | Tenant filtresi | Risk |\n|---|---|---|---|---|---|";
  const p0 = sorted.filter((u) => u.risk === "P0");
  const p1 = sorted.filter((u) => u.risk === "P1");
  const p2 = sorted.filter((u) => u.risk === "P2");
  return `# createAdminClient Envanteri

> ÜRETİLMİŞ DOSYA — elle düzenleme. Yeniden üret: \`npx tsx scripts/audit-admin-client.ts --write\`.
> Yöntem: statik, heuristik (TS AST + regex). Kanıt düzeyi: "var" = kaynakta \`tenant_id\` geçiyor, filtrenin
> doğruluğu DOĞRULANMADI. "belirsiz" = işlev ve dosyada tanınan kapı yok; çağıranlar elle incelenmeli.
> Kapsam: \`src/**\` (test ve \`scripts/\` hariç). Canlı DB'ye bağlanılmadı.

## Özet

- Toplam birim: **${s.total}** (${s.files} dosya) — risk: P0=${s.risk.P0 ?? 0}, P1=${s.risk.P1 ?? 0}, P2=${s.risk.P2 ?? 0}
- Tenant filtresi: ${Object.entries(s.tenantFilter).map(([k, v]) => `${k}=${v}`).join(", ")}
- Kapı türü: ${Object.entries(s.gate).map(([k, v]) => `${k}=${v}`).join(", ")}
- Filtresiz (yok+devir): **${s.unfiltered}**; RLS'li client'a taşıma adayı: **${s.migratable}**

Risk ölçütü: P0 = tenant filtresi yok/devir VE kapı belirsiz; P1 = filtresiz ama kapı zayıf/oturum-izin
(kiracı kimliği istemciden gelirse IDOR), veya yalnız parametre filtreli + zayıf kapı + yazma; P2 = diğerleri.
Not: cron/platform birimlerinin "filtresiz" olması tasarım gereğidir (kiracılar arası iş); P2 sayılır.

## P0 — filtresiz VE kapısı belirsiz (ÖNCE bunlar elle incelenmeli)

${p0.length ? `${head}\n${p0.map(row).join("\n")}` : "Yok."}

## P1

${p1.length ? `${head}\n${p1.map(row).join("\n")}` : "Yok."}

## P2

${p2.length ? `${head}\n${p2.map(row).join("\n")}` : "Yok."}
`;
}

function renderAllowlist(usages: AdminUsage[]): string {
  const lines = usages.map(
    (u) =>
      `  { file: ${JSON.stringify(u.file)}, fn: ${JSON.stringify(u.fn)}, calls: ${u.calls}, tenantFilter: ${JSON.stringify(u.tenantFilter)} },`,
  );
  return `/**
 * createAdminClient KABUL LİSTESİ.
 *
 * ÜRETİLMİŞ: \`npx tsx scripts/audit-admin-client.ts --write\`.
 * Yeni bir createAdminClient kullanımı eklemek testi kırar; bilinçli ekliyorsan
 * önce gerekçeyi docs/security/ADMIN_CLIENT_INVENTORY.md'de incele, sonra listeyi yeniden üret.
 * \`tenantFilter\` "yok" | "devir" olan birimlerin SAYISI artamaz (azalması serbesttir).
 */
export type AdminClientAllowEntry = {
  file: string;
  fn: string;
  calls: number;
  tenantFilter: "var" | "param" | "yok" | "devir" | "uygulanamaz";
};

export const ADMIN_CLIENT_ALLOWLIST: readonly AdminClientAllowEntry[] = [
${lines.join("\n")}
];
`;
}

function main() {
  const root = process.cwd();
  const usages = scanAdminClientUsage(root);
  const args = process.argv.slice(2);
  if (args.includes("--json")) {
    console.log(JSON.stringify({ summary: summarize(usages), usages }, null, 2));
    return;
  }
  if (args.includes("--write")) {
    writeFileSync(resolve(root, "docs/security/ADMIN_CLIENT_INVENTORY.md"), renderMarkdown(usages), "utf8");
    writeFileSync(resolve(root, "src/lib/admin-client-allowlist.ts"), renderAllowlist(usages), "utf8");
    console.log("Yazıldı: docs/security/ADMIN_CLIENT_INVENTORY.md, src/lib/admin-client-allowlist.ts");
  }
  const s = summarize(usages);
  console.log(`createAdminClient birimi: ${s.total} (${s.files} dosya)`);
  console.log("Risk:", s.risk, "| Filtresiz:", s.unfiltered, "| Taşıma adayı:", s.migratable);
  console.log("Kapı:", s.gate);
  for (const u of usages.filter((x) => x.risk === "P0")) {
    console.log(`  P0 ${u.file}:${u.line} ${u.fn} [filtre=${u.tenantFilter}, kapı=${u.gate}]`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
