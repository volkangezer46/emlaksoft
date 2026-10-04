import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ZORLAYICI SÖZLEŞME: telefon/e-posta girişi ve doğrulaması tek tip olmalı.
 *
 *  (a) src/**\/*.tsx içinde ham `type="tel"` / `type="email"` input YASAK -> PhoneInput / EmailInput.
 *  (b) Adı/id'si/autoComplete'i telefon-e-posta çağrıştıran ham <input>/<Input>/<FormInput> YASAK.
 *  (c) src/app/actions/**\/*.ts içinde formData.get("phone"|"email"…) okuyan dosya,
 *      `@/lib/validation/contact` veya yeni doğrulayıcıları (parsePhone, isValidPhone, normalizeEmail,
 *      isValidEmail…) kullanmak ZORUNDA.
 *
 * Mevcut ihlaller aşağıdaki ALLOWLIST'tedir ("rollout bekliyor"). Rollout bir dosyayı düzeltince
 * allowlist'ten SİLİNMELİDİR (eskimiş girdi de fail eder). YENİ ihlal doğrudan fail eder.
 * Yeni girdi eklemek yerine PhoneInput/EmailInput + ortak şemaları kullanın.
 */

/** dosya -> gerekçe. Anahtar: depo köküne göre '/' ayraçlı yol. */
const ALLOWLIST: Record<string, string> = {
  // (a)/(b) ham telefon/e-posta input'ları
  "src/app/app/ayarlar/lead/lead-capture-panel.tsx": "KALICI İSTİSNA: dışa kopyalanacak HTML gömme kodu örnek METNİ (template string); gerçek form alanı değil",
};

const PHONE_EMAIL_WORD = /(?:^|[^a-z])(?:phone|telefon|tel|gsm|mobile|whatsapp|cep|e-?posta|email|mail)(?:[^a-z]|$)/;
/** Sözcük sınırıyla eşleşir (camelCase da ayrılır): "holderPhone" evet, "netgsm"/"exception" hayır. */
function looksLikePhoneOrEmail(value: string): boolean {
  return PHONE_EMAIL_WORD.test(value.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase());
}
// Telefon/e-posta DEĞERİ olmayan, adı benzeyen alanlar (örn. Meta phone_number_id).
const NAME_IGNORE = /(?:^|[_-])(?:number[_-]?id|id)$|numberid$|template|token|secret|language|webhook/i;
const IGNORED_INPUT_TYPES = /\btype=(?:"|\{")(?:hidden|checkbox|radio|submit|button|file)(?:"|"\})/;
const SKIP_UI = new Set(["src/components/ui/phone-input.tsx", "src/components/ui/email-input.tsx"]);

const VALIDATOR_USE =
  /@\/lib\/validation\/contact|\b(?:parsePhone|isValidPhone|isValidOptionalPhone|normalizePhone|toE164Phone|normalizeEmail|parsePhoneStrict|isValidPhoneStrict|isValidEmail|isValidOptionalEmail|phoneSchema|optionalPhoneSchema|emailSchema|optionalEmailSchema)\b/;

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return [path];
  });
}

function rel(file: string): string {
  return relative(".", file).replaceAll("\\", "/");
}

export function findViolations(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (file: string, why: string) => {
    const list = out.get(file) ?? [];
    if (!list.includes(why)) list.push(why);
    out.set(file, list);
  };

  for (const abs of walk("src")) {
    const file = rel(abs);
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;

    if (file.endsWith(".tsx") && !SKIP_UI.has(file)) {
      const source = readFileSync(abs, "utf8");
      if (/\btype=(?:"|\{"|\{')(?:tel|email)(?:"|"\}|'\})/.test(source)) add(file, "ham type=tel/email");
      for (const tag of source.match(/<(?:input|Input|FormInput)\b[\s\S]*?\/>/g) ?? []) {
        if (IGNORED_INPUT_TYPES.test(tag)) continue;
        for (const m of tag.matchAll(/\b(?:name|id|autoComplete)=(?:"([^"]*)"|\{"([^"]*)"\})/g)) {
          const value = m[1] ?? m[2] ?? "";
          if (looksLikePhoneOrEmail(value) && !NAME_IGNORE.test(value)) {
            add(file, `ham input (${value})`);
          }
        }
      }
    }

    if (file.startsWith("src/app/actions/") && file.endsWith(".ts")) {
      const source = readFileSync(abs, "utf8");
      const keys = [...source.matchAll(/\.get\(\s*["'`]([^"'`]+)["'`]\s*\)/g)]
        .map((m) => m[1])
        .filter((k) => looksLikePhoneOrEmail(k) && !NAME_IGNORE.test(k));
      if (keys.length > 0 && !VALIDATOR_USE.test(source)) {
        add(file, `action doğrulayıcısız (${[...new Set(keys)].join(", ")})`);
      }
    }
  }
  return out;
}

describe("telefon/e-posta giriş sözleşmesi", () => {
  const violations = findViolations();

  it("allowlist dışında YENİ ihlal yok", () => {
    const fresh = [...violations].filter(([file]) => !(file in ALLOWLIST));
    const lines = fresh.map(([file, why]) => `  ${file}: ${why.join("; ")}`);
    expect(
      fresh.length,
      `${fresh.length} yeni ihlal. Ham input yerine PhoneInput/EmailInput, action'da ` +
        `@/lib/validation/contact kullanın:\n${lines.join("\n")}`,
    ).toBe(0);
  });

  it("allowlist eskimemiş: temizlenen dosya listeden çıkarılmış", () => {
    const stale = Object.keys(ALLOWLIST).filter((file) => !violations.has(file));
    expect(
      stale,
      `${stale.length} dosya artık ihlal etmiyor; allowlist'ten çıkarın:\n${stale.map((f) => `  ${f}`).join("\n")}`,
    ).toEqual([]);
  });

  it("allowlist girdilerinin gerekçesi var", () => {
    for (const [file, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.trim().length, file).toBeGreaterThan(0);
    }
  });

  it("kalan ihlal sayısı (rollout ilerlemesi)", () => {
    const files = [...violations.keys()].sort();
    // Bilgi amaçlı: ihlal sayısı ve listesi mesajda görünür; allowlist ile birebir olmalı.
    expect(
      files,
      `Toplam ${files.length} ihlalli dosya:\n${files.map((f) => `  ${f}: ${violations.get(f)!.join("; ")}`).join("\n")}`,
    ).toEqual(Object.keys(ALLOWLIST).sort());
  });
});

/**
 * (d) SUNUCU TEK KAPI + (e) PhoneInput tek kaynak.
 *
 * Sunucu dosyası = "use server" bildirimi olan, src/app/actions/ ya da src/app/api/ altındaki dosya.
 * Telefon alanı okuyorsa (`.get("phone")`, `input.phone`...) sıkı doğrulayıcıya referans vermeli
 * (`parsePhoneStrict` / `phoneSchema`; fazla hane ve ülke biçimi bu kapıda reddedilir).
 * İstisnalar GEREKÇELİdir.
 */
const STRICT_USE =
  /\b(?:parsePhoneStrict|isValidPhoneStrict|phoneSchema|optionalPhoneSchema|phoneSchemaFor|optionalPhoneSchemaFor)\b/;
const PHONE_FIELD_READ = /\b(?:input|data|payload|body|values|params)\.(?:phone|telefon|tel|gsm|mobile|whatsapp)\w*\b/;

/** dosya -> gerekçe (telefon alanı okuyup sıkı doğrulayıcıya referans vermeyen sunucu dosyaları). */
const SERVER_PHONE_EXCEPTIONS: Record<string, string> = {
  "src/app/actions/duplicates.ts": "yalnız mükerrer ARAMA: kayıt yazmaz; duplicate-match anahtarı normalize eder",
  "src/app/actions/public-valuation.ts": "telefonu doğrulamadan intakeLead'e iletir; intakeLead (lib/lead-intake.ts) parsePhoneStrict ile doğrular",
  "src/app/api/leads/[token]/route.ts": "telefonu doğrulamadan intakeLead'e iletir; intakeLead (lib/lead-intake.ts) parsePhoneStrict ile doğrular",
};

/** Hafif `parsePhone(` çağrısına izin verilen yerler (istemci önizleme/karşılaştırma; kayıt DEĞİL). */
const LIGHT_PARSE_ALLOWED: Record<string, string> = {
  "src/lib/phone.ts": "tanım dosyası",
  "src/lib/phone-rules.ts": "sıkı doğrulayıcı hafif ayrıştırmanın üstüne kurulur",
  "src/lib/duplicate-match.ts": "mükerrer eşleştirme anahtarı üretir; kayıt/doğrulama değil",
  "src/components/ui/phone-input.tsx": "istemci anlık geri bildirim; sunucu sıkı doğrular",
  "src/app/app/musteriler/yeni/customer-form.tsx": "istemci ön kontrol; sunucu action'ı sıkı doğrular",
};

const USE_CLIENT = /^\s*(?:\/\*[\s\S]*?\*\/\s*)?["']use client["']/;
const USE_SERVER = /^\s*(?:\/\*[\s\S]*?\*\/\s*)?["']use server["']/;

describe("telefon sunucu kapısı ve PhoneInput tek kaynak", () => {
  const server: string[] = [];
  const light: string[] = [];
  const clientRulesImport: string[] = [];
  const phoneInputCopies: string[] = [];

  for (const abs of walk("src")) {
    const file = rel(abs);
    if (!/\.(?:ts|tsx)$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
    const source = readFileSync(abs, "utf8");
    const isClient = USE_CLIENT.test(source);
    const isServerGate =
      USE_SERVER.test(source) || file.startsWith("src/app/actions/") || file.startsWith("src/app/api/");

    if (isServerGate && !isClient) {
      const keys = [...source.matchAll(/\.get\(\s*["'`]([^"'`]+)["'`]\s*\)/g)]
        .map((m) => m[1])
        .filter((k) => looksLikePhoneOrEmail(k) && !NAME_IGNORE.test(k) && !/e-?posta|email|mail/i.test(k));
      if ((keys.length > 0 || PHONE_FIELD_READ.test(source)) && !STRICT_USE.test(source) && !(file in SERVER_PHONE_EXCEPTIONS)) {
        server.push(file);
      }
    }

    if (/(?<![A-Za-z])parsePhone\(/.test(source) && !(file in LIGHT_PARSE_ALLOWED)) light.push(file);

    if (isClient && /from\s+["']@\/lib\/phone-rules["']/.test(source) && !/import\s+type\b[^;]*phone-rules/.test(source)) {
      clientRulesImport.push(file);
    }

    if (file !== "src/components/ui/phone-input.tsx") {
      if (/\bfunction\s+PhoneInput\b|\bconst\s+PhoneInput\s*=/.test(source)) phoneInputCopies.push(file);
      if (/<PhoneInput\b/.test(source) && !/from\s+["']@\/components\/ui\/phone-input["']/.test(source)) {
        phoneInputCopies.push(`${file} (ortak bileşenden import edilmiyor)`);
      }
    }
  }

  it("telefon okuyan sunucu dosyası sıkı doğrulayıcı (parsePhoneStrict / phoneSchema) kullanır", () => {
    expect(server, `Sıkı doğrulayıcı eksik:\n${server.join("\n")}`).toEqual([]);
  });

  it("sunucu istisnaları gerekçeli ve (delege edenler) gerçekten sıkı doğrulayıcıya dayanıyor", () => {
    for (const [f, why] of Object.entries(SERVER_PHONE_EXCEPTIONS)) expect(why.trim().length, f).toBeGreaterThan(0);
    expect(readFileSync("src/lib/lead-intake.ts", "utf8")).toMatch(/parsePhoneStrict(/);
  });

  it("hafif parsePhone( yalnız izinli (istemci/karşılaştırma) dosyalarda; kayıt yapanlar parsePhoneStrict kullanır", () => {
    expect(light, `Hafif parsePhone( kullanımı:\n${light.join("\n")}`).toEqual([]);
    for (const [f, why] of Object.entries(LIGHT_PARSE_ALLOWED)) {
      expect(why.trim().length, f).toBeGreaterThan(0);
      expect(readFileSync(f, "utf8").includes("parsePhone("), `${f} artık hafif parsePhone( kullanmıyor: listeden çıkarın`).toBe(true);
    }
  });

  it("istemci dosyaları phone-rules'u statik import etmez (paket bütçesi: yalnız PhoneInput dinamik yükler)", () => {
    expect(clientRulesImport, `Statik import:\n${clientRulesImport.join("\n")}`).toEqual([]);
  });

  it("PhoneInput kopyalanamaz; kullanım ortak bileşenden gelir", () => {
    expect(phoneInputCopies).toEqual([]);
  });
});
