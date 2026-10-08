import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTHORITY_QUEUE_FILTERS,
  authorityPublishWarning,
  buildAuthorityReminderText,
  canSendReminder,
  classifyAuthority,
  eidsDisplayStatus,
  isAuthorityQueueFilter,
  summarizeAuthorityQueue,
  type AuthorityQueueRow,
} from "@/lib/eids/authority-status";

const NOW = Date.UTC(2026, 9, 8, 9, 0, 0); // 8 Ekim 2026 12:00 TR

const row = (over: Partial<AuthorityQueueRow> = {}): AuthorityQueueRow => ({
  id: "p1",
  status: "live",
  authorization_start: "2026-06-01",
  authorization_end: "2027-06-01",
  authority_doc_no: "YB-1",
  authority_eids_status: "approved",
  authority_owner_approved_at: "2026-06-02T00:00:00Z",
  authority_reminder_sent_at: null,
  authority_reminder_count: 0,
  ...over,
});

describe("eidsDisplayStatus", () => {
  it("süresi dolmuş yetki kayıtlı durumdan bağımsız 'expired' olur", () => {
    expect(eidsDisplayStatus(row({ authorization_end: "2026-10-01", authority_eids_status: "approved" }), NOW)).toBe("expired");
  });
  it("kayıtlı durum korunur; bilinmeyen değer 'pending' sayılır", () => {
    expect(eidsDisplayStatus(row({ authority_eids_status: "rejected" }), NOW)).toBe("rejected");
    expect(eidsDisplayStatus(row({ authority_eids_status: "approved" }), NOW)).toBe("approved");
    expect(eidsDisplayStatus(row({ authority_eids_status: "garip" }), NOW)).toBe("pending");
    expect(eidsDisplayStatus(row({ authority_eids_status: null }), NOW)).toBe("pending");
  });
});

describe("classifyAuthority (kuyruk kovaları)", () => {
  it("sağlıklı portföy hiçbir kovada değildir", () => {
    expect(classifyAuthority(row(), NOW).buckets).toEqual([]);
  });
  it("onayı bekleyen", () => {
    expect(classifyAuthority(row({ authority_eids_status: "pending" }), NOW).buckets).toEqual(["bekleyen"]);
  });
  it("15 gün içinde bitiyor (sınır dahil) ve 16. gün dışarıda", () => {
    expect(classifyAuthority(row({ authorization_end: "2026-10-23" }), NOW).buckets).toEqual(["bitiyor"]);
    expect(classifyAuthority(row({ authorization_end: "2026-10-24" }), NOW).buckets).toEqual([]);
  });
  it("süresi dolmuş; bekleyen kovasına ayrıca düşmez", () => {
    expect(classifyAuthority(row({ authorization_end: "2026-10-07", authority_eids_status: "pending" }), NOW).buckets).toEqual(["dolmus"]);
  });
  it("belgesi eksik", () => {
    expect(classifyAuthority(row({ authority_doc_no: "  " }), NOW).buckets).toEqual(["belgesiz"]);
    expect(classifyAuthority(row({ authority_doc_no: null }), NOW).buckets).toEqual(["belgesiz"]);
  });
  it("bir portföy birden çok kovada olabilir", () => {
    const b = classifyAuthority(row({ authority_eids_status: "pending", authorization_end: "2026-10-12", authority_doc_no: null }), NOW).buckets;
    expect(b).toEqual(["bekleyen", "bitiyor", "belgesiz"]);
  });
  it("kapanmış portföy (satıldı/arşiv) kuyruğa girmez", () => {
    expect(classifyAuthority(row({ status: "sold", authority_eids_status: "pending", authority_doc_no: null }), NOW).buckets).toEqual([]);
  });
});

describe("summarizeAuthorityQueue", () => {
  it("kova sayıları ve benzersiz toplam", () => {
    const s = summarizeAuthorityQueue(
      [
        row({ id: "a", authority_eids_status: "pending" }),
        row({ id: "b", authority_eids_status: "pending", authority_doc_no: null }),
        row({ id: "c", authorization_end: "2026-09-01" }),
        row({ id: "d" }),
      ],
      NOW,
    );
    expect(s.counts).toEqual({ bekleyen: 2, bitiyor: 0, dolmus: 1, belgesiz: 1 });
    expect(s.total).toBe(3);
    expect(s.ids.dolmus).toEqual(["c"]);
  });
  it("süzgeç değerleri URL kontratıyla doğrulanır", () => {
    for (const f of AUTHORITY_QUEUE_FILTERS) expect(isAuthorityQueueFilter(f)).toBe(true);
    expect(isAuthorityQueueFilter("x")).toBe(false);
    expect(isAuthorityQueueFilter(undefined)).toBe(false);
  });
});

describe("hatırlatma", () => {
  it("onayı alınmışsa gerekmez", () => {
    expect(canSendReminder(row({ authority_eids_status: "approved" }), NOW).ok).toBe(false);
  });
  it("24 saat içinde ikinci hatırlatma yok; sonra serbest", () => {
    const recent = new Date(NOW - 3 * 3_600_000).toISOString();
    const old = new Date(NOW - 25 * 3_600_000).toISOString();
    const r1 = canSendReminder(row({ authority_eids_status: "pending", authority_reminder_sent_at: recent }), NOW);
    expect(r1.ok).toBe(false);
    expect(r1.reason).toContain("21 saat");
    expect(canSendReminder(row({ authority_eids_status: "pending", authority_reminder_sent_at: old }), NOW).ok).toBe(true);
    expect(canSendReminder(row({ authority_eids_status: "pending" }), NOW).ok).toBe(true);
  });
  it("metin: ad, ofis, ilan ve bitiş tarihi; en çok 460 karakter; reklam içermez", () => {
    const t = buildAuthorityReminderText({ ownerName: "Ayşe Demir", office: "Demo Emlak", propertyLabel: "P-12 Kadıköy 2+1", endDate: "2026-10-20" });
    expect(t).toContain("Sayın Ayşe Demir");
    expect(t).toContain("Demo Emlak");
    expect(t).toContain("P-12 Kadıköy 2+1");
    expect(t).toContain("20.10.2026");
    expect(t).toContain("EİDS");
    expect(t.length).toBeLessThanOrEqual(460);
    expect(buildAuthorityReminderText({ propertyLabel: "x".repeat(900) }).length).toBeLessThanOrEqual(460);
  });
});

describe("authorityPublishWarning", () => {
  it("dolmuş, reddedilmiş, tarihsiz ve onaysız portföyde uyarır; onaylı ve süresi uygunda uyarmaz", () => {
    expect(authorityPublishWarning(row({ authorization_end: "2026-09-01" }), NOW)).toContain("süresi dolmuş");
    expect(authorityPublishWarning(row({ authority_eids_status: "rejected" }), NOW)).toContain("reddetmiş");
    expect(authorityPublishWarning(row({ authorization_end: null }), NOW)).toContain("bitiş tarihi girilmemiş");
    expect(authorityPublishWarning(row({ authority_eids_status: "pending" }), NOW)).toContain("onayı henüz alınmadı");
    expect(authorityPublishWarning(row(), NOW)).toBeNull();
  });
});

describe("yetki kuyruğu sözleşmesi", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("her action requirePermission('portals', 'edit') ile kapılı ve İYS kapısından geçer", () => {
    const src = read("src/app/actions/authority-queue.ts");
    expect((src.match(/requirePermission\("portals", "edit"\)/g) ?? []).length).toBe(2);
    expect(src).toContain('kind: "authority_reminder"');
    expect(src.indexOf("gateIysRecipient(")).toBeLessThan(src.indexOf("sendSignerSms(gate.tenantId"));
    expect(src).not.toMatch(/createAdminClient/);
    expect(src).not.toMatch(/Date\.now\(\)|new Date\(\)/);
  });

  it("sayfa kapısı, sekme ve iki yönlü URL filtresi", () => {
    const page = read("src/app/app/ilan-kontrol/yetki/page.tsx");
    expect(page).toContain('requireModulePage("portals", "/app/ilan-kontrol")');
    expect(page).toContain("sp.kova");
    expect(page).toContain("sp.sayfa");
    expect(read("src/components/listing-control/sub-nav.tsx")).toContain("/yetki");
    expect(existsSync(join(process.cwd(), "src/app/app/ilan-kontrol/yetki/loading.tsx"))).toBe(true);
  });

  it("migration + rollback çifti vardır; durum üçlüsü kısıtlıdır, 'süresi doldu' saklanmaz", () => {
    const sql = read("supabase/migrations/20261008001300_property_authority_status.sql");
    expect(sql).toContain("authority_eids_status in ('pending', 'approved', 'rejected')");
    expect(existsSync(join(process.cwd(), "supabase/rollbacks/20261008001300_property_authority_status.rollback.sql"))).toBe(true);
  });

  it("portal yayını yetki uyarısını döner (engellemez)", () => {
    const src = read("src/app/actions/portal-publish.ts");
    expect(src).toContain("authorityPublishWarning(");
    expect(src).toContain("warning");
  });

  it("insights kuralı yalnız bitişi geçmişi yakalar (deadline@1 / authority_renewal@1 ile çakışmaz)", () => {
    const facts = read("src/lib/insights/authority-facts.ts");
    expect(facts).toContain('.lt("authorization_end", today)');
    expect(facts).toContain('.eq("tenant_id", tenantId)');
  });
});
