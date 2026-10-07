import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  ActionUserError,
  SESSION_EXPIRED_MESSAGE,
  actionErrorMessage,
  actionErrorSubject,
  classifyActionError,
  sqlRaiseMessage,
} from "@/lib/action-errors";

/**
 * Action hata mesajı sözleşmesi.
 *
 *  1) `src/app/actions/**` kullanıcıya ham `error.message` döndürmez (Supabase/PostgREST/Auth/iyzico
 *     teknik metni, İngilizce, PII içerebilir) — `actionErrorMessage(error, "<özne>")` kullanılır,
 *     ham metin orada loglanır.
 *  2) Çıplak "…edilemedi." / "…başarısız." mesajı yazılmaz: kullanıcı NE OLDUĞUNU ve NE YAPACAĞINI
 *     görmeli. Özne cümlesi `actionErrorMessage(...)` (veya onu çağıran yerel sarmalayıcı) içine verilir.
 *
 * Yeni istisna gerekiyorsa gerekçesiyle aşağıdaki listelere ekleyin.
 */

const ACTIONS_DIR = path.join(process.cwd(), "src/app/actions");

function actionFiles(): { rel: string; src: string }[] {
  return readdirSync(ACTIONS_DIR)
    .filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))
    .map((n) => ({ rel: `src/app/actions/${n}`, src: readFileSync(path.join(ACTIONS_DIR, n), "utf8").replace(/\r\n/g, "\n") }));
}

/** Yorum satırlarını atlayarak (satır no, satır) çiftleri. */
function codeLines(src: string): [number, string][] {
  const out: [number, string][] = [];
  let inBlock = false;
  src.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (inBlock) {
      if (t.includes("*/")) inBlock = false;
      return;
    }
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) inBlock = true;
      return;
    }
    if (t.startsWith("//") || t.startsWith("*")) return;
    out.push([i + 1, line]);
  });
  return out;
}

/** Ham mesaj istisnaları: dosya → gerekçe. */
const RAW_MESSAGE_EXEMPT: Record<string, string> = {};

/** Hata nesnesi adları (alan adı `message` olan alan nesneleri — approval.message, loop.message — kapsam dışı). */
const ERR = String.raw`\b(?:e|ex|err|error|reason|[a-z]\w*(?:Err|Error))(?:\?)?\.message\b(?!\??\.(?:toLowerCase|includes|startsWith|match)\b)`;
const RAW_RETURN_RES = [
  // { error: error.message } / { error: e instanceof Error ? e.message : ... } / { error: x?.message ?? ... }
  new RegExp(String.raw`\berror:\s*[^,}]*?` + ERR),
  // `...${error.message}...` içeren hata metni
  new RegExp(String.raw`\berror:\s*\x60[^\x60]*\$\{[^}]*` + ERR),
  // return e.message;
  new RegExp(String.raw`\breturn\s+` + ERR + String.raw`\s*;`),
];

const VERBS =
  "edilemedi|başarısız|yapılamadı|alınamadı|oluşturulamadı|kaydedilemedi|silinemedi|güncellenemedi|gönderilemedi|yüklenemedi|eklenemedi|okunamadı|açılamadı|değiştirilemedi|kapatılamadı|tamamlanamadı|başlatılamadı|getirilemedi|çalıştırılamadı|sıfırlanamadı|doğrulanamadı|kaldırılamadı|uygulanamadı|bağlanamadı|üretilemedi|hazırlanamadı|aktarılamadı|taşınamadı|atanamadı|işlenemedi|yazılamadı|çekilemedi|verilemedi|reddedilemedi|onaylanamadı|kopyalanamadı|geri alınamadı|ayarlanamadı|düzenlenemedi|yenilenemedi|bitirilemedi|başarısız oldu";
/** Yalnız başarısızlık cümlesi (neden/eylem yok): "<özne> <fiil>." (+ "Lütfen tekrar deneyin."). */
const GENERIC_ONLY = new RegExp(
  `^[^:;()\\[\\]{}<>\`"]{0,80}\\b(${VERBS})\\.?( Lütfen (daha sonra )?tekrar deneyin\\.?)?$`,
  "u",
);
/** Özne cümlesini kullanıcı mesajına çeviren çağrılar (hepsi actionErrorMessage'a düşer). */
const SUBJECT_CALLS = /(actionErrorMessage|dbError|rpcFailure|schemaError|schemaOrGeneric)\(/;
/** Kullanıcıya dönmeyen satırlar: log, fırlatma (sınır hata sayfası digest gösterir), uyarı listesi. */
const NON_USER_LINE = /console\.|\blog\.(error|warn|info)\(|throw new Error\(|logActivity|warnings\.push/;

describe("action hata mesajı sözleşmesi", () => {
  const files = actionFiles();

  it("action dosyaları taranıyor", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("action'lar kullanıcıya ham error.message döndürmez", () => {
    const bad: string[] = [];
    for (const { rel, src } of files) {
      if (RAW_MESSAGE_EXEMPT[rel]) continue;
      for (const [no, line] of codeLines(src)) {
        if (/console\.|\blog\.(error|warn|info)\(|\.test\(|issues\[/.test(line)) continue;
        if (RAW_RETURN_RES.some((re) => re.test(line))) bad.push(`${rel}:${no}: ${line.trim().slice(0, 140)}`);
      }
    }
    expect(bad, `ham hata metni döndüren satırlar (actionErrorMessage kullanın):\n${bad.join("\n")}`).toEqual([]);
  });

  it('çıplak "…edilemedi." mesajı yok (NE OLDU + NE YAPMALI)', () => {
    const bad: string[] = [];
    for (const { rel, src } of files) {
      for (const [no, line] of codeLines(src)) {
        if (NON_USER_LINE.test(line)) continue;
        for (const m of line.matchAll(/"([^"\\]*)"/g)) {
          const msg = m[1];
          if (!GENERIC_ONLY.test(msg) || /\b(ancak|fakat|ama)\b/.test(msg)) continue;
          const before = line.slice(0, m.index);
          if (SUBJECT_CALLS.test(before)) continue;
          if ((before.match(/\$\{/g) ?? []).length > (before.match(/\}/g) ?? []).length) continue;
          bad.push(`${rel}:${no}: "${msg}"`);
        }
      }
    }
    expect(bad, `çıplak hata mesajları:\n${bad.join("\n")}`).toEqual([]);
  });

  it("yerel sarmalayıcılar actionErrorMessage'a düşer", () => {
    const wrappers: [string, string][] = [
      ["src/app/actions/advisor-profile.ts", "function dbError("],
      ["src/app/actions/tickets.ts", "function rpcFailure("],
      ["src/app/actions/surveys.ts", "function schemaError("],
      ["src/app/actions/access-control.ts", "function schemaOrGeneric("],
    ];
    for (const [rel, sig] of wrappers) {
      const src = readFileSync(path.join(process.cwd(), rel), "utf8");
      const start = src.indexOf(sig);
      expect(start, `${rel} ${sig}`).toBeGreaterThan(-1);
      const body = src.slice(start, src.indexOf("\n}", start));
      expect(body, `${rel} ${sig}`).toContain("actionErrorMessage(");
    }
  });
});

describe("actionErrorMessage", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});

  it("Postgres/PostgREST kodlarını sınıflandırır", () => {
    expect(classifyActionError({ code: "23505", message: "duplicate key value" })).toBe("duplicate");
    expect(classifyActionError({ code: "23503" })).toBe("linked");
    expect(classifyActionError({ code: "42501", message: "new row violates row-level security policy" })).toBe("permission");
    expect(classifyActionError({ code: "PGRST116" })).toBe("not_found");
    expect(classifyActionError({ code: "57014" })).toBe("timeout");
    expect(classifyActionError({ code: "PGRST202" })).toBe("schema");
    expect(classifyActionError({ message: "new row violates row-level security policy for table x" })).toBe("permission");
    expect(classifyActionError(new TypeError("fetch failed"))).toBe("network");
    expect(classifyActionError({ name: "AbortError", message: "aborted" })).toBe("timeout");
    expect(classifyActionError({ code: "weak_password", status: 422 })).toBe("weak_password");
    expect(classifyActionError({ status: 429 })).toBe("rate_limit");
    expect(classifyActionError(null)).toBe("unknown");
  });

  it("NE OLDU + NE YAPMALI biçiminde mesaj üretir, ham metni göstermez", () => {
    const raw = { code: "23505", message: 'duplicate key value violates unique constraint "customers_phone_key"' };
    const msg = actionErrorMessage(raw, "Müşteri kaydedilemedi.");
    expect(msg).toMatch(/^Müşteri kaydedilemedi: aynı bilgilerle bir kayıt zaten var/);
    expect(msg).not.toContain("duplicate key");
    expect(actionErrorMessage({ code: "42501" }, "Kayıt silinemedi")).toBe(
      "Kayıt silinemedi: bu işlem için yetkiniz yok; ofis yöneticinizden izin isteyin.",
    );
    expect(actionErrorMessage(new Error("socket hang up"), "Kayıt kaydedilemedi")).toMatch(/bağlantı sorunu olabilir; birkaç saniye sonra tekrar deneyin/);
    expect(actionErrorMessage(null, "Görev oluşturulamadı. Lütfen tekrar deneyin.")).toMatch(/^Görev oluşturulamadı: beklenmeyen bir sorun/);
  });

  it("bağlama özel ek verilebilir", () => {
    expect(actionErrorMessage({ code: "23505" }, "Takım oluşturulamadı", { duplicate: "bu adla bir takım zaten var." })).toBe(
      "Takım oluşturulamadı: bu adla bir takım zaten var.",
    );
  });

  it("ActionUserError metni olduğu gibi geçer", () => {
    expect(actionErrorMessage(new ActionUserError("Hesap kredisi bakiyesi yetersiz."), "Fatura oluşturulamadı")).toBe(
      "Hesap kredisi bakiyesi yetersiz.",
    );
  });

  it("ham metni loglar (PII maskeli)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    actionErrorMessage({ code: "XX000", message: "hata: ali@example.com" }, "Kayıt kaydedilemedi");
    const line = String(spy.mock.calls.at(-1)?.[0] ?? "");
    expect(line).toContain("action_error");
    expect(line).toContain("XX000");
    expect(line).not.toContain("ali@example.com");
  });

  it("özne cümlesi sadeleşir", () => {
    expect(actionErrorSubject("Not kaydedilemedi. Lütfen tekrar deneyin.")).toBe("Not kaydedilemedi");
    expect(actionErrorSubject("Durum güncellenemedi.")).toBe("Durum güncellenemedi");
  });

  it("sqlRaiseMessage yalnız kullanıcı için yazılmış raise mesajını geçirir", () => {
    expect(sqlRaiseMessage({ code: "P0001", message: "Bu müşteri daha önce anonimleştirilmiş." })).toBe(
      "Bu müşteri daha önce anonimleştirilmiş.",
    );
    expect(sqlRaiseMessage({ code: "23505", message: "duplicate key" })).toBeNull();
    expect(sqlRaiseMessage({ code: "42501", message: "new row violates row-level security policy" }, ["42501"])).toBeNull();
    expect(sqlRaiseMessage({ code: "42501", message: "Atama yetkiniz yok." }, ["42501"])).toBe("Atama yetkiniz yok.");
  });

  it("oturum mesajı eylem söyler", () => {
    expect(SESSION_EXPIRED_MESSAGE).toMatch(/yeniden giriş/);
  });
});
