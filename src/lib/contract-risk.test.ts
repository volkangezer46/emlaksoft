import { describe, expect, it } from "vitest";
import { COMMISSION_CAP_PCT, riskSummary, scanContract, type ContractInput } from "./contract-risk";

/**
 * Sözleşme tarayıcısı bir "gönder tuşuna basmadan önce bak" listesi üretiyor.
 * Yanlış NEGATİF (riski kaçırmak) burada asıl tehlike: kullanıcı listeyi boş
 * görüp doldurulmamış bir sözleşmeyi imzaya gönderir.
 */

const SABIT_AN = new Date("2026-07-26T12:00:00Z");
const gunSonra = (n: number) => new Date(SABIT_AN.getTime() + n * 86_400_000).toISOString();

const temel: ContractInput = {
  contractType: "sozlesme",
  title: "Hizmet sözleşmesi",
  body: "A".repeat(400),
  status: "draft",
  signedAt: null,
  expiresAt: null,
  createdAt: gunSonra(-10),
  signerCount: 1,
  hasProperty: true,
  hasCustomer: true,
};

const ile = (p: Partial<ContractInput>): ContractInput => ({ ...temel, ...p });
const kodlar = (i: ContractInput) => scanContract(i, SABIT_AN).map((r) => r.code);

describe("doldurulmamış alanlar", () => {
  it("şablondan kalan ___ alanlarını bulur", () => {
    const r = scanContract(ile({ body: "Satıcı: ______\nAlıcı: ______\n" + "x".repeat(300) }), SABIT_AN);
    const bulgu = r.find((x) => x.code === "blank_placeholder");
    expect(bulgu).toBeDefined();
    expect(bulgu!.title).toContain("2");
  });

  it("taslakta uyarı, taslak dışında HATA", () => {
    const govde = "Satıcı: ______" + "x".repeat(300);
    const taslak = scanContract(ile({ body: govde, status: "draft" }), SABIT_AN);
    const gonderildi = scanContract(ile({ body: govde, status: "sent" }), SABIT_AN);
    expect(taslak.find((x) => x.code === "blank_placeholder")!.level).toBe("warning");
    // İmzaya gitmiş bir sözleşmede boş alan artık uyarı değil, hatadır.
    expect(gonderildi.find((x) => x.code === "blank_placeholder")!.level).toBe("error");
  });

  it("iki alt çizgi yer tutucu sayılmaz", () => {
    // Metinde "__" geçebilir; yer tutucu eşiği üç ve üzeri.
    expect(kodlar(ile({ body: "a__b" + "x".repeat(300) }))).not.toContain("blank_placeholder");
  });

  it("temiz metinde bulgu yok", () => {
    expect(kodlar(temel)).not.toContain("blank_placeholder");
  });
});

describe("beklenen maddeler", () => {
  it("kira sözleşmesinde eksik maddeleri sayar", () => {
    const r = scanContract(ile({ contractType: "kira", body: "Kira bedeli aylık ödenir." + "x".repeat(300) }), SABIT_AN);
    const bulgu = r.find((x) => x.code === "missing_clause");
    expect(bulgu).toBeDefined();
    // depozito, süre, artış eksik — kira bedeli var
    expect(bulgu!.detail).toContain("Depozito");
    expect(bulgu!.detail).not.toContain("Kira bedeli");
  });

  it("tüm maddeler varsa uyarı vermez", () => {
    const govde = "Kira bedeli, depozito, süre ve artış maddeleri burada. " + "x".repeat(300);
    expect(kodlar(ile({ contractType: "kira", body: govde }))).not.toContain("missing_clause");
  });

  it("büyük/küçük harf ve Türkçe karakter duyarsız arar", () => {
    const govde = "KİRA BEDELİ · DEPOZİTO · SÜRE · ARTIŞ " + "x".repeat(300);
    expect(kodlar(ile({ contractType: "kira", body: govde }))).not.toContain("missing_clause");
  });

  it("tanımsız türde madde kontrolü yapmaz", () => {
    expect(kodlar(ile({ contractType: "diger" }))).not.toContain("missing_clause");
  });
});

describe("tarih tutarlılığı", () => {
  it("süresi dolmuş ve imzalanmamış → hata", () => {
    expect(kodlar(ile({ expiresAt: gunSonra(-3) }))).toContain("expired_unsigned");
  });

  it("süresi dolmuş ama İMZALANMIŞ → hata yok", () => {
    // İmzalanmış sözleşmenin geçerlilik tarihini geçmesi normal.
    expect(kodlar(ile({ expiresAt: gunSonra(-3), status: "signed", signedAt: gunSonra(-5) }))).not.toContain(
      "expired_unsigned",
    );
  });

  it("7 gün içinde dolacaksa uyarır", () => {
    expect(kodlar(ile({ expiresAt: gunSonra(3) }))).toContain("expiring_soon");
    expect(kodlar(ile({ expiresAt: gunSonra(30) }))).not.toContain("expiring_soon");
  });

  it("imza tarihi geçerlilikten sonraysa hata", () => {
    expect(kodlar(ile({ expiresAt: gunSonra(-10), signedAt: gunSonra(-2), status: "signed" }))).toContain(
      "signed_after_expiry",
    );
  });

  it("imza tarihi oluşturmadan önceyse hata", () => {
    expect(kodlar(ile({ createdAt: gunSonra(-2), signedAt: gunSonra(-9), status: "signed" }))).toContain(
      "signed_before_created",
    );
  });

  it("geçersiz tarih metni patlatmaz", () => {
    expect(() => scanContract(ile({ expiresAt: "tarih-degil", signedAt: "yok" }), SABIT_AN)).not.toThrow();
    expect(kodlar(ile({ expiresAt: "tarih-degil" }))).not.toContain("expired_unsigned");
  });
});

describe("imzacı ve bağlantılar", () => {
  it("taslak dışında imzacı yoksa hata", () => {
    expect(kodlar(ile({ signerCount: 0, status: "sent" }))).toContain("no_signers");
  });

  it("taslakta imzacı yokluğu sorun değil", () => {
    expect(kodlar(ile({ signerCount: 0, status: "draft" }))).not.toContain("no_signers");
  });

  it("portföy/müşteri eksikliği bilgi seviyesinde", () => {
    const r = scanContract(ile({ hasProperty: false, hasCustomer: false }), SABIT_AN);
    expect(r.find((x) => x.code === "no_property")!.level).toBe("info");
    expect(r.find((x) => x.code === "no_customer")!.level).toBe("info");
  });
});

describe("hizmet bedeli sınırı", () => {
  it("sınırın üstünde uyarır", () => {
    expect(kodlar(ile({ commissionRate: COMMISSION_CAP_PCT + 1 }))).toContain("commission_cap");
  });

  it("sınırda ve altında uyarmaz", () => {
    expect(kodlar(ile({ commissionRate: COMMISSION_CAP_PCT }))).not.toContain("commission_cap");
    expect(kodlar(ile({ commissionRate: 2 }))).not.toContain("commission_cap");
  });

  it("oran yoksa uyarmaz", () => {
    expect(kodlar(ile({ commissionRate: null }))).not.toContain("commission_cap");
  });

  it("uyarı hukuki hüküm kurmaz, teyide yönlendirir", () => {
    const r = scanContract(ile({ commissionRate: 10 }), SABIT_AN);
    const b = r.find((x) => x.code === "commission_cap")!;
    expect(b.detail).toContain("hukuki tespit değil");
    expect(b.level).toBe("warning"); // engelleyici değil
  });
});

describe("sıralama ve özet", () => {
  it("hatalar uyarılardan, uyarılar bilgilerden önce", () => {
    const r = scanContract(
      ile({ status: "sent", signerCount: 0, hasProperty: false, body: "___" + "x".repeat(300) }),
      SABIT_AN,
    );
    const seviyeler = r.map((x) => x.level);
    const ilkUyari = seviyeler.indexOf("warning");
    const ilkBilgi = seviyeler.indexOf("info");
    const sonHata = seviyeler.lastIndexOf("error");
    expect(sonHata).toBeLessThan(ilkUyari === -1 ? Infinity : ilkUyari);
    if (ilkUyari !== -1 && ilkBilgi !== -1) expect(ilkUyari).toBeLessThan(ilkBilgi);
  });

  it("temiz sözleşmede hiç bulgu yok", () => {
    const temiz = ile({
      contractType: "kira",
      body: "Kira bedeli, depozito, süre ve artış maddeleri düzenlenmiştir. " + "x".repeat(300),
      status: "signed",
      signedAt: gunSonra(-1),
      expiresAt: gunSonra(300),
      signerCount: 2,
      commissionRate: 3,
    });
    expect(scanContract(temiz, SABIT_AN)).toEqual([]);
  });

  it("özet sayaçları tutarlı", () => {
    const r = scanContract(ile({ status: "sent", signerCount: 0, hasProperty: false }), SABIT_AN);
    const s = riskSummary(r);
    expect(s.error + s.warning + s.info).toBe(s.total);
    expect(s.total).toBe(r.length);
  });
});
