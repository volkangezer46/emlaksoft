import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dealMissing, DEAL_TABS } from "@/app/app/anlasmalar/yeni/deal-tabs";
import { appointmentMissing, APPOINTMENT_TABS } from "@/app/app/randevular/yeni/appointment-tabs";
import { CUSTOMER_TABS } from "@/app/app/musteriler/yeni/customer-tabs";
import { missingFieldsError } from "./form-rules";

const root = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("dealMissing", () => {
  it("boş anlaşma: taraf + tutar = 2 eksik", () => {
    expect(dealMissing({}).map((i) => i.key)).toEqual(["party", "value"]);
  });
  it("müşteri ya da portföy tek başına yeter", () => {
    expect(dealMissing({ customer_id: "c", deal_value: "1" })).toEqual([]);
    expect(dealMissing({ property_id: "p", deal_value: "1" })).toEqual([]);
  });
  it("eksikler var olan sekmelere işaret eder", () => {
    const ids = DEAL_TABS.map((t) => t.id as string);
    for (const i of dealMissing({})) expect(ids).toContain(i.tab);
  });
});

describe("appointmentMissing", () => {
  it("yer göstermede müşteri ve portföy ayrı ayrı zorunlu", () => {
    expect(appointmentMissing({ appointment_type: "showing" }).map((i) => i.key)).toEqual(["customer", "property"]);
    expect(appointmentMissing({ appointment_type: "showing", customer_id: "c" }).map((i) => i.key)).toEqual(["property"]);
    expect(appointmentMissing({ appointment_type: "showing", customer_id: "c", property_id: "p" })).toEqual([]);
  });
  it("diğer türlerde en az biri", () => {
    expect(appointmentMissing({ appointment_type: "valuation" }).map((i) => i.key)).toEqual(["party"]);
    expect(appointmentMissing({ appointment_type: "valuation", property_id: "p" })).toEqual([]);
  });
  it("eksikler var olan sekmelere işaret eder", () => {
    const ids = APPOINTMENT_TABS.map((t) => t.id as string);
    for (const i of appointmentMissing({ appointment_type: "showing" })) expect(ids).toContain(i.tab);
  });
});

describe("missingFieldsError", () => {
  it("Türkçe tek cümle", () => {
    expect(missingFieldsError([{ label: "Tutar" }, { label: "Müşteri ya da portföy" }])).toBe("Eksik alan: Tutar, Müşteri ya da portföy.");
  });
});

describe("KQ3 form sözleşmesi", () => {
  it("anlaşma ve randevu formları kural + 'N eksik' kabuğunu kullanır; anlaşma mobilde ilk adımda 'Sonraki'", () => {
    const deal = read("src/app/app/anlasmalar/yeni/new-deal-form.tsx");
    expect(deal).toContain("rules={dealMissing}");
    expect(deal).toContain("mobileNextFirst");
    const appt = read("src/app/app/randevular/yeni/appointment-form.tsx");
    expect(appt).toContain("rules={appointmentMissing}");
    expect(appt).toMatch(/isPast\(at\)/);
  });

  it("sunucu action'ları aynı kuralı uygular", () => {
    expect(read("src/app/actions/deals.ts")).toMatch(/dealMissing\(/);
    expect(read("src/app/actions/appointments.ts")).toMatch(/appointmentMissing\(/);
  });

  it("çakışma uyarısı ofis saat dilimiyle biçimlenir (çıplak Intl yok)", () => {
    const src = read("src/app/actions/appointments.ts");
    expect(src).toContain("formatOfficeTime(clash.scheduled_at)");
    expect(src).not.toMatch(/new Intl\.DateTimeFormat\(/);
    expect(src).not.toMatch(/86_400_000/);
  });

  it("müşteri formunda telefon ilk adımda, çift kayıt uyarısı telefonun yanında", () => {
    const kisi = CUSTOMER_TABS[0];
    expect(kisi.id).toBe("kisi");
    expect(kisi.fields as readonly string[]).toContain("phone");
    const src = read("src/app/app/musteriler/yeni/customer-form.tsx");
    const kisiPanel = src.slice(src.indexOf("kisi: ("), src.indexOf("iletisim: ("));
    expect(kisiPanel).toContain('name="phone"');
    expect(kisiPanel).toContain('<DuplicateHint kind="customer" />');
    expect(src).toContain("Telefonsuz kaydet");
  });

  it("muhasebe diyaloğu eksikte pasif düğme yerine 'N eksik' rozeti kullanır", () => {
    const src = read("src/app/app/giderler/_components/entry-dialog.tsx");
    expect(src).toContain("<MissingCountBadge count={missing.length} />");
    expect(src).toContain('disabled={upload.status === "uploading"}');
  });
});

describe("KQ3 odak sırası ve tek seferlik onaylar", () => {
  it("anlaşma tutarında native required yok: ilk eksik odağı dealMissing sırasıyla (önce taraf, sonra tutar)", () => {
    const src = read("src/app/app/anlasmalar/yeni/new-deal-form.tsx");
    expect(src).toMatch(/<FormInput name="deal_value"(?![^>]*\brequired\b)[^>]*\/>/);
    expect(dealMissing({}).map((i) => i.key)).toEqual(["party", "value"]);
  });

  it("telefonsuz kayıt onayı kullanıldıktan sonra sıfırlanır", () => {
    const src = read("src/app/app/musteriler/yeni/customer-form.tsx");
    expect(src).toMatch(/noPhoneOk\.current = false;/);
  });
});
