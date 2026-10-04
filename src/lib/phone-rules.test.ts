import { describe, expect, it } from "vitest";
import { parsePhone } from "./phone";
import {
  capNationalStrict,
  formatNationalLive,
  interpretPhoneEntryStrict,
  maxNationalDigits,
  parsePhoneStrict,
} from "./phone-rules";
import { getPhoneCountry } from "./phone-countries";

/**
 * Ülke matrisi: her ülke KENDİ biçimine göre doğrulanır. Geçerli örnekler gerçek numaralandırma planındandır
 * (libphonenumber-js metadata'sı doğrular); fazla/eksik hane, yapıştırma ve saklama biçimi sabitlenir.
 */
const MATRIX: Array<{ iso: string; dial: string; valid: string; wrongStart?: string }> = [
  { iso: "TR", dial: "90", valid: "5446346444" },
  { iso: "DE", dial: "49", valid: "15123456789" },
  { iso: "US", dial: "1", valid: "2125551234" },
  { iso: "GB", dial: "44", valid: "7400123456" },
  { iso: "AZ", dial: "994", valid: "501234567" },
  { iso: "RU", dial: "7", valid: "9123456789" },
  { iso: "FR", dial: "33", valid: "612345678" },
  { iso: "NL", dial: "31", valid: "612345678" },
  { iso: "SA", dial: "966", valid: "512345678" },
  { iso: "AE", dial: "971", valid: "501234567" },
  { iso: "ES", dial: "34", valid: "612345678" },
  { iso: "IT", dial: "39", valid: "3123456789" },
  { iso: "PL", dial: "48", valid: "512345678" },
  { iso: "CH", dial: "41", valid: "781234567" },
  { iso: "AT", dial: "43", valid: "664123456" },
  { iso: "UA", dial: "380", valid: "501234567" },
  { iso: "GE", dial: "995", valid: "555123456" },
  { iso: "IN", dial: "91", valid: "8123456789" },
];

const VARIABLE_LENGTH = new Set(["DE", "AT"]);

describe("ülke matrisi (sunucu: parsePhoneStrict)", () => {
  for (const c of MATRIX) {
    describe(`${c.iso} +${c.dial}`, () => {
      it("geçerli numara: uluslararası biçim kabul, saklama +E.164 (TR: 0'lı)", () => {
        const p = parsePhoneStrict(`+${c.dial} ${c.valid}`);
        expect(p.ok, p.error).toBe(true);
        expect(p.stored).toBe(c.iso === "TR" ? `0${c.valid}` : `+${c.dial}${c.valid}`);
        expect(p.e164).toBe(`+${c.dial}${c.valid}`);
      });

      it("00 öneki ve yapıştırma biçimleri aynı sonuca varır", () => {
        const a = parsePhoneStrict(`+${c.dial}${c.valid}`);
        const b = parsePhoneStrict(`00${c.dial}${c.valid}`);
        const d = parsePhoneStrict(`+${c.dial} (${c.valid.slice(0, 3)}) ${c.valid.slice(3)}`);
        expect(b.stored).toBe(a.stored);
        expect(d.stored).toBe(a.stored);
      });

      it("fazla hane reddedilir", () => {
        expect(parsePhoneStrict(`+${c.dial}${c.valid}123456`).ok).toBe(false);
        // DE/AT gibi değişken uzunluklu planlarda ±1 hane de geçerli olabilir (gerçek plan); kesin sınır yalnız sabit uzunlukta.
        if (!VARIABLE_LENGTH.has(c.iso)) expect(parsePhoneStrict(`+${c.dial}${c.valid}1`).ok).toBe(false);
      });

      it("az hane reddedilir", () => {
        expect(parsePhoneStrict(`+${c.dial}${c.valid.slice(0, 4)}`).ok).toBe(false);
        if (!VARIABLE_LENGTH.has(c.iso)) expect(parsePhoneStrict(`+${c.dial}${c.valid.slice(0, -2)}`).ok).toBe(false);
      });

      it("harf içeren girdi reddedilir", () => {
        expect(parsePhoneStrict(`+${c.dial}${c.valid}x`).ok).toBe(false);
        expect(parsePhoneStrict(`abc +${c.dial}${c.valid}`).ok).toBe(false);
      });

      it("giriş kırpma: ülkenin en uzun olası uzunluğunu aşan rakam yazılmaz", () => {
        const max = maxNationalDigits(c.iso);
        expect(max).not.toBeNull();
        expect(max!).toBeGreaterThanOrEqual(c.valid.length);
        const capped = capNationalStrict(c.iso, `${c.valid}987654321987654321`);
        if (c.iso === "TR") expect(capped.length).toBe(11);
        else expect(capped.length).toBeLessThanOrEqual(max!);
        const r = interpretPhoneEntryStrict(`+${c.dial}${c.valid}987654321987654321`, "TR");
        expect(r.country === c.iso || c.dial === "1" || c.dial === "7").toBe(true);
        expect(r.trimmed).toBe(true);
      });

      it("yapıştırma ülkeyi otomatik seçer", () => {
        const r = interpretPhoneEntryStrict(`+${c.dial} ${c.valid}`, "TR");
        expect(r.pending).toBeNull();
        expect(r.trimmed).toBe(false);
        expect(getPhoneCountry(r.country)?.dial).toBe(c.dial);
      });
    });
  }
});

describe("Türkiye özel durumları (önce/sonra)", () => {
  const VALID: Array<[string, string]> = [
    ["05446346444", "05446346444"],
    ["5446346444", "05446346444"],
    ["0544 634 64 44", "05446346444"],
    ["0 (544) 634-64-44", "05446346444"],
    ["+905446346444", "05446346444"],
    ["+90 544 634 64 44", "05446346444"],
    ["905446346444", "05446346444"],
    ["00905446346444", "05446346444"],
    ["02125551234", "02125551234"],
    ["+90 212 555 12 34", "02125551234"],
    ["03125551234", "03125551234"],
    ["04625551234", "04625551234"],
    ["08501234567", "08501234567"],
  ];
  for (const [input, stored] of VALID) {
    it(`kabul: ${input} -> ${stored}`, () => {
      const p = parsePhoneStrict(input);
      expect(p.ok, p.error).toBe(true);
      expect(p.stored).toBe(stored);
    });
  }

  const INVALID = [
    "054463464441", // 12 hane
    "0544634644412345", // alakasız fazla hane
    "544634644412",
    "+9054463464441",
    "+90 544 634 64 44 1",
    "0090544634644412",
    "0544634644", // 10 hane, 0'lı = ulusal 9
    "054463464", // az hane
    "0444123", // 444 özel kısa hat (7 hane) saklama biçimine uymaz
    "09051234567", // 9 ile başlayan: geçerli plan değil
    "08001234567", // 8 ile başlayan, 850 dışı
    "01125551234", // 1 ile başlayan alan kodu yok
    "0544 634 64 4a",
    "05446346444abc",
    "05446346444 ext",
    "",
    "   ",
  ];
  for (const input of INVALID) {
    it(`red: "${input}"`, () => {
      expect(parsePhoneStrict(input).ok).toBe(false);
    });
  }

  it("canlı giriş: 11+ hane yazılmaz, uyarı bilgisi döner", () => {
    const r = interpretPhoneEntryStrict("054463464441", "TR");
    expect(r.digits).toBe("05446346444");
    expect(r.trimmed).toBe(true);
    expect(r.maxDigits).toBe(10);
  });

  it("canlı giriş: 0'sız 10 hane kırpılmaz, 0 eklenir", () => {
    const r = interpretPhoneEntryStrict("5446346444", "TR");
    expect(r.digits).toBe("05446346444");
    expect(r.trimmed).toBe(false);
  });

  it("canlı giriş: harf atılır ve bildirilir", () => {
    const r = interpretPhoneEntryStrict("0544abc634", "TR");
    expect(r.digits).toBe("0544634");
    expect(r.rejectedChars).toBe(true);
  });

  it("görüntü: 0544 634 64 44 (4-3-2-2)", () => {
    expect(formatNationalLive("TR", "05446346444")).toBe("0544 634 64 44");
    expect(formatNationalLive("TR", "0544")).toBe("0544");
  });
});

describe("saklama biçimi korunur (parsePhone ile uyumlu)", () => {
  it("parsePhoneStrict, parsePhone'un kabul ettiği geçerli numarada AYNI stored/e164 değerini üretir", () => {
    for (const c of MATRIX) {
      const input = `+${c.dial}${c.valid}`;
      const a = parsePhone(input);
      const b = parsePhoneStrict(input);
      expect(b.stored).toBe(a.stored);
      expect(b.e164).toBe(a.e164);
      expect(b.country).toBe(a.country);
    }
  });

  it("TR saklama: cep 05XXXXXXXXX, sabit 0XXXXXXXXXX; yabancı +E.164", () => {
    expect(parsePhoneStrict("+90 544 634 64 44").stored).toBe("05446346444");
    expect(parsePhoneStrict("+90 212 555 12 34").stored).toBe("02125551234");
    expect(parsePhoneStrict("0049 151 23456789").stored).toBe("+4915123456789");
  });

  it("ülkeye göre geçersiz ama biçimce makul numara sunucuda reddedilir (parsePhone yalnız yapısal)", () => {
    // US alan kodu 1XX geçersiz (NANP: 2-9 ile başlar)
    expect(parsePhoneStrict("+1 1235551234").ok).toBe(false);
  });
});

describe("ülkeye özel biçimlendirme", () => {
  it("TR dışı: rakam sayısı değişmez", () => {
    for (const c of MATRIX.filter((x) => x.iso !== "TR")) {
      const out = formatNationalLive(c.iso, c.valid);
      expect(out.replace(/\D/g, "")).toBe(c.valid);
    }
  });
});
