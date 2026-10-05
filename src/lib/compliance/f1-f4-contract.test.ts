import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const LEDGER_SQL = "supabase/migrations/20260821000200_compliance_ledger.sql";
const REQUEST_SQL = "supabase/migrations/20260821000300_document_requests.sql";

describe("F1 yasal kayıt defteri sözleşmesi", () => {
  const sql = read(LEDGER_SQL);
  it("tenant_id + RLS + değiştirilemezlik tetiği var, UPDATE/DELETE yetkisi verilmez", () => {
    expect(sql).toMatch(/enable row level security/g);
    expect(sql).toContain("tenant_id = public.current_tenant_id()");
    expect(sql).toContain("before update or delete on public.compliance_ledger_entries");
    expect(sql).toContain("grant select, insert on public.compliance_ledger_entries to authenticated");
    expect(sql).not.toMatch(/grant[^;]*(update|delete)[^;]*compliance_ledger_entries/i);
    expect(sql).not.toMatch(/create policy[^;]*compliance_ledger_entries[^;]*for (update|delete|all)/i);
  });
  it("danışman yalnız kendi kaydını görür; ofis sahibi/GM hepsini", () => {
    expect(sql).toContain("current_profile_role() in ('owner','gm') or created_by = auth.uid()");
  });
  it("TC kimlik numarası kolonu yoktur", () => {
    expect(sql).not.toMatch(/\b(tc_?kimlik|tckn|national_id|identity_number|id_number)\b/i);
  });
  it("action'lar kapılı; CSV yalnız owner/gm ve denetim logu yazar; log kişisel veri taşımaz", () => {
    const src = read("src/app/actions/compliance-ledger.ts");
    expect(src.match(/requirePermission\(/g)?.length).toBe(3);
    expect(src).toContain('isOfficeLevel(gate.role)');
    expect(src).toContain('action: "export.csv"');
    expect(src).not.toMatch(/newValue:\s*\{[^}]*party_name/);
    expect(src).not.toMatch(/\.(update|delete|upsert)\(\s*\{?[^)]*compliance_ledger_entries/);
    expect(src).not.toMatch(/from\("compliance_ledger_entries"\)\s*\.(update|delete)/);
  });
  it("sayfa hukuki uyarıyı ve MASAK bildirimi yapılmadığını söyler", () => {
    expect(read("src/lib/compliance/ledger.ts")).toContain("hukuki danışmanlık değildir");
    expect(read("src/lib/compliance/ledger.ts")).toContain("bildirim göndermez");
  });
});

describe("F4 evrak linki sözleşmesi", () => {
  const sql = read(REQUEST_SQL);
  it("ham token saklanmaz, yalnız özet; tenant_id + RLS", () => {
    expect(sql).toContain("token_hash");
    expect(sql).not.toMatch(/\btoken\s+text/i);
    expect(sql).toMatch(/enable row level security/g);
    expect(sql).toContain("tenant_id = public.current_tenant_id()");
    expect(sql).not.toMatch(/to anon/i);
  });
  it("public sayfa noindex, rate limit, is_sample ve aydınlatma yer tutucusu içerir", () => {
    const page = read("src/app/evrak/[token]/page.tsx");
    expect(page).toContain("index: false");
    expect(page).toContain("checkRateLimit(");
    expect(page).toContain('failurePolicy: "deny"');
    expect(page).toContain("KVKK_PLATFORM_NOTICE_TEXT");
    expect(page).not.toContain("KVKK_PLACEHOLDER_TEXT"); // yer tutucu canlıda görünmez
    const server = read("src/lib/doc-request/server.ts");
    expect(server).toContain("request.is_sample");
    expect(server).toContain("c?.is_sample");
    expect(server).toContain("isPublicTenantActive");
    expect(server).toContain('"documents"');
  });
  it("public action'lar süre/iptal denetler, hız sınırı fail-closed, mevcut müşteri dosyası doğrulamasını kullanır", () => {
    const src = read("src/app/actions/document-request-public.ts");
    expect(src).toContain('validateDirectFileUploadMetadata("customer_file"');
    expect(src).toContain("verifyDocumentFile");
    const calls = src.split("checkRateLimit(").length - 1;
    expect(calls).toBeGreaterThan(0);
    expect(src.split('failurePolicy: "deny"').length - 1).toBe(calls);
    expect(src).toContain("lookup.state");
    expect(src).not.toMatch(/tenant_id:\s*(formData|input)/);
  });
  it("staff action'ları kapılı; OCR yalnız öneri döner, kimlik/PDF dışlanır, kayıt yok", () => {
    const src = read("src/app/actions/document-requests.ts");
    expect(src.match(/requirePermission\(/g)?.length).toBe(4);
    expect(src).toContain("isOcrEligible(");
    expect(src).toContain("isDocOcrConfigured()");
    const ocr = src.slice(src.indexOf("export async function suggestDocumentFields"));
    expect(ocr).not.toMatch(/\.(insert|update|upsert)\(/);
    expect(src).not.toContain("api.openai.com");
  });
  it("kimlik belgesi OCR listesinde yok", async () => {
    const { OCR_ALLOWED_TYPES } = await import("@/lib/doc-request/doc-request");
    expect(OCR_ALLOWED_TYPES).not.toContain("identity");
  });
  it("public rota modül kaydında belge merkezine bağlı", async () => {
    const { featureForPublicPath } = await import("@/lib/modules/registry");
    expect(featureForPublicPath("/evrak/abc")).toBe("documents");
  });
});
