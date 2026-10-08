import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SÖZLEŞME: mesaj gönderen her kod yolu ya TİCARİ (merkezi İYS kapısından geçer) ya İŞLEM AMAÇLI (muaf, gerekçeli) ya da
 * ALTYAPI olarak kayıtlıdır. Yeni bir gönderim yolu eklenirse bu kayıt güncellenmeden test kırılır: ticari ileti kapısız çıkamaz.
 */
const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(relative(root, full).split(sep).join("/"));
  }
  return out;
}

const SEND_RE = /\b(sendSignerSms|sendTenantSms|prepareTenantSmsSender|prepareTenantWhatsAppSender|sendTenantWhatsApp\w*|sendSms|sendEmail|sendWhatsApp\w*)\b/;

/** Ticari gönderim yolları: gate.ts'i çağırmak ZORUNDA (kampanya teslimi DB'deki eşdeğer kapıyı çağırır). */
const COMMERCIAL: Record<string, string> = {
  "src/lib/automation-engine.ts": 'kind: "automation"',
  "src/lib/surveys/dispatch.ts": 'kind: "survey"',
  "src/app/actions/communications.ts": 'kind: "marketing_single"',
  "src/app/actions/authority-queue.ts": 'kind: "authority_reminder"',
};

/** İşlem amaçlı: İYS kapsamı dışında; her biri gerekçeli. */
const TRANSACTIONAL: Record<string, string> = {
  "src/app/actions/auth.ts": "doğrulama kodu / hesap güvenliği",
  "src/app/giris/dogrulama/actions.ts": "giriş doğrulama kodu",
  "src/app/actions/contract-reminders.ts": "sözleşme imza hatırlatması",
  "src/app/actions/contract-signers.ts": "sözleşme imza daveti",
  "src/app/actions/contracts.ts": "sözleşme imza akışı",
  "src/app/actions/tenant-integrations.ts": "ofisin kendi numarasına entegrasyon test mesajı",
  "src/app/actions/whatsapp-reply.ts": "müşterinin başlattığı WhatsApp oturumuna yanıt",
  "src/lib/owner-report/run.ts": "malike hizmet raporu (işlem amaçlı)",
  "src/lib/rent-reminders/run.ts": "kira/aidat vade hatırlatması (işlem amaçlı)",
  "src/lib/email/trial-reminder.ts": "ofis sahibine abonelik bildirimi",
};

/** Altyapı: sağlayıcı sarmalayıcıları (kendileri ileti kararı vermez). */
const INFRA = new Set([
  "src/lib/messaging/netgsm.ts",
  "src/lib/messaging/tenant-providers.ts",
  "src/lib/email/provider.ts",
  "src/app/imza/_lib/sms.ts",
]);

/** Kampanya teslimi: kanal bazlı izin DB'de kampanya alıcısı başına doğrulanır (gate.ts ile aynı kural). */
const CAMPAIGN_DELIVERY = "src/lib/campaign-delivery.ts";
/** Kullanıcı arayüzü yalnız ticari action'ı çağırır. */
const UI_ONLY = new Set(["src/app/app/gelen-kutusu/reply-draft-button.tsx"]);

describe("İYS kapısı sözleşmesi", () => {
  const senders = walk(join(root, "src")).filter((f) => SEND_RE.test(read(f)));

  it("mesaj gönderen her dosya kayıtlıdır (ticari / işlem amaçlı / altyapı)", () => {
    const known = new Set([...Object.keys(COMMERCIAL), ...Object.keys(TRANSACTIONAL), ...INFRA, CAMPAIGN_DELIVERY, ...UI_ONLY]);
    const unknown = senders.filter((f) => !known.has(f));
    expect(unknown, `Kayıtsız gönderim yolu: ${unknown.join(", ")} — ticari ise gate.ts'e bağlayın, işlem amaçlıysa gerekçeyle kaydedin.`).toEqual([]);
  });

  it("kayıtlı ticari yollar merkezi kapıyı çağırır", () => {
    for (const [file, marker] of Object.entries(COMMERCIAL)) {
      const src = read(file);
      expect(src, file).toContain('from "@/lib/iys/gate"');
      expect(src, file).toContain(marker);
      expect(src, file).toMatch(/gateIysRecipients?\(/);
    }
  });

  it("ticari yollar kendi izin sorgusunu yazmaz (tek karar yeri gate.ts)", () => {
    for (const file of Object.keys(COMMERCIAL)) {
      expect(read(file), file).not.toContain('.from("iys_consents")');
    }
  });

  it("kampanya teslimi alıcı başına DB onay doğrulamasından geçer ve oluşturma ekranı kapıyı önizler", () => {
    const worker = read(CAMPAIGN_DELIVERY);
    expect(worker.indexOf("claim_campaign_recipient_delivery")).toBeLessThan(worker.indexOf("verify_campaign_recipient_consent"));
    expect(worker.indexOf("verify_campaign_recipient_consent")).toBeLessThan(worker.indexOf("sendToProvider(delivery"));
    const actions = read("src/app/actions/campaigns.ts");
    expect(actions).toContain('kind: "campaign"');
    expect(actions).toContain("gateIysRecipients(");
    expect(actions).toContain("requirePermission(\"campaigns\", \"create\")");
  });

  it("DB kampanya onayı gate.ts ile aynı kuralı uygular (granted + geri alınmamış)", () => {
    const sql = read("supabase/migrations/20260810000920_campaign_delivery_compliance.sql");
    expect(sql).toContain("v_consent.status <> 'granted'");
    expect(sql).toContain("v_consent.revoked_at is not null");
    const gate = read("src/lib/iys/gate.ts");
    expect(gate).toContain('row.status === "granted"');
    expect(gate).toContain("row.revoked_at");
  });

  it("işlem amaçlı kayıtların hepsi gerekçelidir ve ticari listeyle çakışmaz", () => {
    for (const [file, why] of Object.entries(TRANSACTIONAL)) {
      expect(why.length, file).toBeGreaterThan(5);
      expect(Object.keys(COMMERCIAL)).not.toContain(file);
    }
  });

  it("kapı dosyası yeni istemci oluşturmaz, service_role içermez ve ham Date kullanmaz", () => {
    const gate = read("src/lib/iys/gate.ts");
    expect(gate).not.toMatch(/createAdminClient|createClient\(/);
    expect(gate).not.toMatch(/Date\.now\(\)|new Date\(\)/);
  });
});
