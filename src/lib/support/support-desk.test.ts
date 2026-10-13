import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { addBusinessMinutes, businessMinutesBetween, clockToMinutes, DEFAULT_BUSINESS_DAYS } from "@/lib/support/business-hours";
import { computeDeskReport, percentile, type DeskTicketRow } from "@/lib/support/desk-report";
import { canEditMacros, macroActionsFromForm, normalizeTag, parseMacroActions, parseTagList, renderMacroBody } from "@/lib/support/macro-template";
import { DEFAULT_SLA_POLICY, parseSlaMatrixForm, resolveSlaTarget } from "@/lib/support/sla-policy";
import { platformCanAccess } from "@/lib/platform-access";
import { getSettingDef } from "@/lib/settings/registry";

const calendar = { days: DEFAULT_BUSINESS_DAYS, holidays: ["2026-10-29"] };

describe("iş saati (TS aynası; DB ile aynı kural)", () => {
  it("cuma 17:30 + 2 iş saati = pazartesi 10:30 (kabul ölçütü)", () => {
    const due = addBusinessMinutes(new Date("2026-10-16T14:30:00Z"), 120, calendar);
    expect(due.toISOString()).toBe("2026-10-19T07:30:00.000Z");
  });
  it("mesai öncesi açılan bilet 09:00'dan sayılır; tatil atlanır", () => {
    expect(addBusinessMinutes(new Date("2026-10-19T04:00:00Z"), 60, calendar).toISOString()).toBe("2026-10-19T07:00:00.000Z");
    expect(addBusinessMinutes(new Date("2026-10-28T14:00:00Z"), 120, calendar).toISOString()).toBe("2026-10-30T07:00:00.000Z");
  });
  it("açık gün yoksa takvim dakikası; iş dakikası farkı", () => {
    const closed = { days: DEFAULT_BUSINESS_DAYS.map((d) => ({ ...d, isOpen: false })), holidays: [] };
    expect(addBusinessMinutes(new Date("2026-10-16T14:30:00Z"), 60, closed).toISOString()).toBe("2026-10-16T15:30:00.000Z");
    expect(businessMinutesBetween(new Date("2026-10-16T14:30:00Z"), new Date("2026-10-19T07:30:00Z"), calendar)).toBe(120);
    expect(clockToMinutes("09:30")).toBe(570);
    expect(clockToMinutes("25:00")).toBeNull();
  });
});

describe("SLA matrisi", () => {
  it("plana özel satır varsayılanı ezer; yoksa '*'", () => {
    const rows = [
      { plan: "*", priority: "high", first_response_minutes: 240, resolution_minutes: 1080 },
      { plan: "professional", priority: "high", first_response_minutes: 120, resolution_minutes: 960 },
    ];
    expect(resolveSlaTarget(rows, "professional", "high").firstResponseMinutes).toBe(120);
    expect(resolveSlaTarget(rows, "office", "high").firstResponseMinutes).toBe(240);
    expect(resolveSlaTarget([], "office", "normal")).toEqual(DEFAULT_SLA_POLICY.normal);
  });
  it("form: '*' zorunlu, plan satırı ya tam ya boş, saat → dakika", () => {
    const values: Record<string, string> = {};
    for (const p of ["low", "normal", "high", "urgent"]) {
      values[`fr:*:${p}`] = "8";
      values[`rs:*:${p}`] = "27";
    }
    values["fr:professional:high"] = "2";
    values["rs:professional:high"] = "16";
    const ok = parseSlaMatrixForm((n) => values[n] ?? "");
    expect(ok.error).toBeUndefined();
    expect(ok.entries.find((e) => e.plan === "professional")).toEqual({ plan: "professional", priority: "high", firstResponseMinutes: 120, resolutionMinutes: 960 });
    expect(parseSlaMatrixForm((n) => ({ ...values, "rs:professional:high": "" })[n] ?? "").error).toMatch(/birlikte/);
    expect(parseSlaMatrixForm((n) => ({ ...values, "fr:*:low": "" })[n] ?? "").error).toMatch(/varsayılan/);
    expect(parseSlaMatrixForm((n) => ({ ...values, "fr:*:low": "1,5" })[n] ?? "").error).toBeUndefined();
  });
});

describe("makro şablonu ve eylemleri", () => {
  it("değişkenler dolar; bilinmeyen değişken korunur; boş değer yedeğe düşer", () => {
    const out = renderMacroBody("Merhaba {{kullanici.ad}}, {{ ofis.ad }} için {{bilet.no}} incelendi. {{bilinmeyen.alan}}", {
      "kullanici.ad": "Ayşe",
      "ofis.ad": "Mavi Emlak",
      "bilet.no": "",
    });
    expect(out).toBe("Merhaba Ayşe, Mavi Emlak için talebiniz incelendi. {{bilinmeyen.alan}}");
  });
  it("kullanıcı adı yoksa 'Merhaba Merhaba' olmaz: nötr hitap, cümle başında büyük harf", () => {
    expect(renderMacroBody("Merhaba {{kullanici.ad}},", {})).toBe("Merhaba değerli kullanıcımız,");
    expect(renderMacroBody("Merhaba {{kullanici.ad}},", { "kullanici.ad": "  " })).toBe("Merhaba değerli kullanıcımız,");
    expect(renderMacroBody("{{kullanici.ad}}, talebiniz alındı.", {})).toBe("Değerli kullanıcımız, talebiniz alındı.");
    expect(renderMacroBody("Teşekkürler. {{kullanici.ad}} için not", {})).toBe("Teşekkürler. Değerli kullanıcımız için not");
  });
  it("etiket normalizasyonu ve eylem ayrıştırma", () => {
    expect(normalizeTag("  İADE ")).toBe("iade");
    expect(normalizeTag("-x")).toBeNull();
    expect(parseTagList("fatura, iade , fatura;  ")).toEqual(["fatura", "iade"]);
    expect(parseMacroActions({ status: "resolved", priority: "high", assign: "me", addTags: ["Fatura", 3] })).toEqual({
      priority: "high",
      assign: "me",
      addTags: ["fatura"],
    });
    const form = macroActionsFromForm((n) => ({ action_status: "waiting", action_tags: "iade" })[n] ?? "");
    expect(form).toEqual({ actions: { status: "waiting", addTags: ["iade"] } });
    expect(macroActionsFromForm((n) => ({ action_status: "closed" })[n] ?? "").error).toBeTruthy();
  });
  it("makro düzenleme yetkisi destek rolüne açık, muhasebeye kapalı", () => {
    expect(canEditMacros("support")).toBe(true);
    expect(canEditMacros("ops")).toBe(true);
    expect(canEditMacros("billing")).toBe(false);
  });
});

describe("destek BI hesabı", () => {
  const base: Omit<DeskTicketRow, "id"> = {
    created_at: "2026-10-05T07:00:00Z",
    status: "closed",
    category: "billing",
    priority: "normal",
    assigned_staff_id: "a",
    tags: ["fatura"],
    first_response_at: "2026-10-05T08:00:00Z",
    first_response_due_at: "2026-10-05T15:00:00Z",
    first_response_breached_at: null,
    resolved_at: "2026-10-05T11:00:00Z",
    resolution_due_at: "2026-10-07T15:00:00Z",
    resolution_breached_at: null,
  };
  it("medyan/p90, SLA uyum oranı, CSAT ortalaması ve kırılımlar", () => {
    const rows: DeskTicketRow[] = [
      { ...base, id: "1" },
      { ...base, id: "2", first_response_at: "2026-10-05T17:00:00Z", assigned_staff_id: null, tags: [] },
      { ...base, id: "3", status: "open", category: "bug", resolved_at: null, first_response_at: null, first_response_due_at: "2026-10-30T00:00:00Z" },
    ];
    const r = computeDeskReport(rows, [{ score: 5, created_at: "2026-10-06T10:00:00Z" }, { score: 4, created_at: "2026-10-06T10:00:00Z" }], Date.parse("2026-10-13T00:00:00Z"));
    expect(r.firstResponse.medianHours).toBe(5.5);
    expect(r.firstResponseSla).toEqual({ measured: 2, met: 1, rate: 50 });
    // 3. biletin çözüm hedefi geçti (çözülmedi) → kaçırıldı
    expect(r.resolutionSla).toEqual({ measured: 3, met: 2, rate: 66.7 });
    expect(r.csat.average).toBe(4.5);
    expect(r.byCategory[0]).toEqual({ key: "billing", count: 2, open: 0 });
    expect(r.byAgent.find((a) => a.key === "atanmadi")?.count).toBe(1);
    expect(r.byTag).toEqual([{ key: "fatura", count: 2, open: 1 }]);
    expect(r.weeks[0].weekStart).toBe("2026-10-05");
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1);
  });
});

describe("AD9 sözleşmesi", () => {
  it("muhasebe rolü destek kuyruğuna erişir (Faturalama ataması); ayarlar kayıtlı", () => {
    expect(platformCanAccess("billing", "tickets")).toBe(true);
    expect(getSettingDef("support.auto_assign_enabled")?.default).toBe(true);
    expect(getSettingDef("support.waiting_automation_enabled")?.default).toBe(false);
    expect(getSettingDef("support.reply_email_enabled")?.default).toBe(false);
  });
  it("cron yeni route eklemez, otomasyonu ayrık adım olarak çağırır; makro yetkisi süper admine kilitli değil", () => {
    const cron = readFileSync(resolve(process.cwd(), "src/app/api/cron/ticket-sla/route.ts"), "utf8");
    expect(cron).toContain("runWaitingAutomation(admin)");
    const ops = readFileSync(resolve(process.cwd(), "src/app/actions/admin-ticket-ops.ts"), "utf8");
    const extra = readFileSync(resolve(process.cwd(), "src/app/actions/admin-ticket-extra.ts"), "utf8");
    expect(ops).not.toContain('staff.role !== "super_admin"');
    expect(extra).not.toContain('staff.role !== "super_admin"');
    expect(ops).toContain("canEditMacros(staff.role)");
  });
});
