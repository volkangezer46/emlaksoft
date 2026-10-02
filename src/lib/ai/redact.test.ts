import { describe, expect, it } from "vitest";
import { isValidTcKimlik, passesLuhn, Redactor } from "./redact";

// Geçerli örnek TC (algoritmayı sağlar): 10000000146
const TC = "10000000146";
const CARD = "4111 1111 1111 1111"; // Luhn geçerli test kartı

function r(text: string, opts?: ConstructorParameters<typeof Redactor>[0]) {
  const red = new Redactor(opts);
  return { out: red.redactText(text), red };
}

describe("doğrulayıcılar", () => {
  it("TC kimlik algoritması", () => {
    expect(isValidTcKimlik(TC)).toBe(true);
    expect(isValidTcKimlik("10000000147")).toBe(false);
    expect(isValidTcKimlik("00000000000")).toBe(false);
    expect(isValidTcKimlik("1234567890")).toBe(false);
  });
  it("Luhn", () => {
    expect(passesLuhn("4111111111111111")).toBe(true);
    expect(passesLuhn("4111111111111112")).toBe(false);
  });
});

describe("telefon", () => {
  it.each([
    "05321234567",
    "0532 123 45 67",
    "0532-123-45-67",
    "0 532 123 45 67",
    "+90 532 123 45 67",
    "+905321234567",
    "0090 532 123 45 67",
    "905321234567",
    "5321234567",
    "532 123 45 67",
    "(0532) 123 45 67",
    "0212 555 11 22",
    "+90 (212) 555 11 22",
    "0532 123 4567",
  ])("%s maskelenir", (p) => {
    const { out } = r(`Beni ${p} numarasından arayın.`);
    expect(out).toBe("Beni [TELEFON_1] numarasından arayın.");
  });

  it("aynı numara farklı biçimde aynı token'ı alır", () => {
    const { out } = r("0532 123 45 67 ve +90 532 123 45 67, ayrıca 0533 999 88 77");
    expect(out).toBe("[TELEFON_1] ve [TELEFON_1], ayrıca [TELEFON_2]");
  });

  it.each([
    "Tutar 1.250.000 TL",
    "5.000.000 TL bütçe",
    "Tarih 05.10.2026",
    "2026-05-10 14:30",
    "10/05/2026",
    "Daire 3+1, 120 m2",
    "Ada 1234 parsel 56",
    "5000 TL",
    "Fiyat 12345678 TL",
  ])("yanlış pozitif yok: %s", (t) => {
    expect(r(t).out).toBe(t);
  });
});

describe("TC kimlik", () => {
  it("geçerli TC maskelenir", () => {
    expect(r(`TC: ${TC}`).out).toBe("TC: [TC_KIMLIK_1]");
  });
  it("rastgele 11 haneli sayı maskelenmez", () => {
    expect(r("Sipariş 12345678901 onaylandı").out).toBe("Sipariş 12345678901 onaylandı");
  });
  it("uzun sayının parçası maskelenmez", () => {
    expect(r(`Kod ${TC}5`).out).toBe(`Kod ${TC}5`);
  });
  it("ondalıklı tutar maskelenmez", () => {
    expect(r(`Tutar ${TC},50 TL`).out).toBe(`Tutar ${TC},50 TL`);
  });
});

describe("e-posta, IBAN, kart", () => {
  it("e-posta", () => {
    const { out } = r("Mail: Ali.Veli+x@Ornek.com.tr ve ali.veli+x@ornek.com.tr");
    expect(out).toBe("Mail: [E_POSTA_1] ve [E_POSTA_1]");
  });
  it("IBAN boşluklu ve bitişik", () => {
    const { out } = r("IBAN TR33 0006 1005 1978 6457 8413 26 veya TR330006100519786457841326");
    expect(out).toBe("IBAN [IBAN_1] veya [IBAN_1]");
  });
  it("kart numarası (Luhn geçerli)", () => {
    expect(r(`Kart ${CARD} son`).out).toBe("Kart [KART_1] son");
    expect(r("Kart 4111-1111-1111-1111").out).toBe("Kart [KART_1]");
  });
  it("Luhn geçersiz 16 hane maskelenmez", () => {
    expect(r("Ref 4111 1111 1111 1112").out).toBe("Ref 4111 1111 1111 1112");
  });
  it("13 haneli zaman damgası maskelenmez", () => {
    expect(r("ts=1700000000000").out).toBe("ts=1700000000000");
  });
  it("UUID bozulmaz", () => {
    const u = "123e4567-e89b-12d3-a456-426614174000";
    expect(r(`id ${u}`).out).toBe(`id ${u}`);
  });
});

describe("geri çevirme", () => {
  it("yanıttaki token'ları orijinale çevirir", () => {
    const { red } = r("Ara: 0532 123 45 67, mail ali@ornek.com");
    expect(red.restoreText("Müşteriyi [TELEFON_1] ile arayın; [E_POSTA_1] yazın. [TELEFON_9]")).toBe(
      "Müşteriyi 0532 123 45 67 ile arayın; ali@ornek.com yazın. [TELEFON_9]",
    );
  });
  it("derin yapıda maskeler ve image_url'e dokunmaz", () => {
    const red = new Redactor();
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "tel 05321234567" },
            { type: "image_url", image_url: { url: "data:image/png;base64,05321234567" } },
          ],
        },
      ],
    };
    const out = red.redactDeep(body);
    expect(JSON.stringify(out)).toContain("[TELEFON_1]");
    expect(JSON.stringify(out)).toContain("data:image/png;base64,05321234567");
    expect(red.restoreDeep(out)).toEqual(body);
  });
  it("akışta bölünmüş token'ı birleştirir", () => {
    const { red } = r("0532 123 45 67");
    const s = red.createStreamRestorer();
    const parts = ["Ara ", "[TEL", "EFON_", "1] hemen", " [not", " bir şey"];
    const out = parts.map((p) => s.push(p)).join("") + s.flush();
    expect(out).toBe("Ara 0532 123 45 67 hemen [not bir şey");
  });
});

describe("ad maskeleme (isteğe bağlı)", () => {
  it("varsayılan kapalı", () => {
    expect(r("Ayşe Yılmaz aradı").out).toBe("Ayşe Yılmaz aradı");
  });
  it("names verilirse maskelenir", () => {
    const { out, red } = r("Ayşe Yılmaz aradı, ayşe yılmaz tekrar", { names: ["Ayşe Yılmaz"] });
    expect(out).toBe("[KISI_1] aradı, [KISI_1] tekrar");
    expect(red.restoreText("[KISI_1] için not")).toBe("Ayşe Yılmaz için not");
  });
});
