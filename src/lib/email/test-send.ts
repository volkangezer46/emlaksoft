import { fetchExternal, externalErrorMetadata, readExternalJson } from "@/lib/external-fetch";
import { emailFromDomain, resolveEmailChannelConfig, sendEmail, type EmailSendResult } from "./provider";
import { EMAIL_TEMPLATES, renderTemplate, type EmailTemplateKey } from "./templates";

/**
 * E-posta kanalı denetimi: Resend bağlantı testi (GET /domains, 5 sn) ve personelin KENDİ adresine test/örnek gönderim.
 * Alıcı parametresi YOKTUR: gönderim yalnız oturumdaki personelin e-postasına gider (kötüye kullanımla dışarıya posta
 * atılamaz). Anahtar değeri sonuçlara/loglara girmez.
 */

export type DomainCheck = {
  name: string;
  status: string;
  /** SPF/DKIM kayıt durumları (Resend alan adı ayrıntısından); okunamazsa boş. */
  records: { record: string; status: string }[];
};

export type ConnectionTestResult =
  | { ok: true; domains: DomainCheck[]; fromDomain: string | null; fromDomainVerified: boolean | null }
  | { ok: false; error: string };

const RESEND_API = "https://api.resend.com";
const TIMEOUT_MS = 5_000;

type DomainListJson = { data?: { id?: string; name?: string; status?: string }[] };
type DomainDetailJson = { records?: { record?: string; status?: string }[] };

export async function testResendConnection(): Promise<ConnectionTestResult> {
  const cfg = await resolveEmailChannelConfig();
  if (!cfg.apiKey) return { ok: false, error: cfg.reason ?? "Resend API anahtarı tanımlı değil." };
  const headers = { Authorization: `Bearer ${cfg.apiKey}` };
  try {
    const res = await fetchExternal(`${RESEND_API}/domains`, { method: "GET", headers }, { timeoutMs: TIMEOUT_MS });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      if (res.status === 401 || res.status === 403) return { ok: false, error: "Anahtar reddedildi (yetkisiz). Anahtarı kontrol edin." };
      return { ok: false, error: `Resend yanıtı: HTTP ${res.status}` };
    }
    const json = await readExternalJson<DomainListJson>(res, 256 * 1024);
    const list = (json.data ?? []).filter((d) => typeof d.name === "string").slice(0, 10);
    const fromDomain = emailFromDomain(cfg.from);
    // SPF/DKIM ayrıntısı yalnız gönderen alan adı için okunur (tek ek istek, aynı süre sınırı).
    const domains: DomainCheck[] = await Promise.all(
      list.map(async (d) => {
        const base: DomainCheck = { name: String(d.name), status: String(d.status ?? "unknown"), records: [] };
        if (!d.id || String(d.name).toLowerCase() !== fromDomain) return base;
        try {
          const r = await fetchExternal(`${RESEND_API}/domains/${encodeURIComponent(d.id)}`, { method: "GET", headers }, { timeoutMs: TIMEOUT_MS });
          if (!r.ok) {
            await r.body?.cancel().catch(() => undefined);
            return base;
          }
          const detail = await readExternalJson<DomainDetailJson>(r, 256 * 1024);
          const records = (detail.records ?? [])
            .filter((x) => x.record === "SPF" || x.record === "DKIM")
            .map((x) => ({ record: String(x.record), status: String(x.status ?? "unknown") }));
          return { ...base, records };
        } catch {
          return base;
        }
      }),
    );
    const match = fromDomain ? domains.find((d) => d.name.toLowerCase() === fromDomain) : undefined;
    return { ok: true, domains, fromDomain, fromDomainVerified: match ? match.status.toLowerCase() === "verified" : fromDomain ? false : null };
  } catch (e) {
    const meta = externalErrorMetadata(e);
    console.error("testResendConnection", meta);
    return { ok: false, error: meta.kind === "timeout" || meta.kind === "aborted" ? "Resend 5 saniyede yanıt vermedi." : "Resend'e bağlanılamadı." };
  }
}

/** Şablon örnek verisi (gerçek kişi/ofis verisi YOK). */
export const SAMPLE_TEMPLATE_VARS: Record<EmailTemplateKey, Record<string, string | number>> = {
  trial_ending: { ofis: "Örnek Emlak Ofisi", gun: 3, baglanti: "https://emlaksoft.com.tr/app/abonelik" },
  owner_weekly_report: { ofis: "Örnek Emlak Ofisi", portfoy: "Örnek Mah. 3+1 Daire", baglanti: "https://emlaksoft.com.tr/" },
  daily_digest: { ofis: "Örnek Emlak Ofisi", ozet: "Bugün 3 yeni talep, 2 randevu ve 1 imza bekleyen anlaşma var.", baglanti: "https://emlaksoft.com.tr/app" },
};

export type SelfSendKind = { type: "test" } | { type: "template"; key: EmailTemplateKey; subject: string; body: string };

/** Gönderilecek konu/metin (SAF). Şablon örneği "[Örnek]" önekiyle işaretlenir. */
export function buildSelfEmail(kind: SelfSendKind, staffName: string): { subject: string; text: string } {
  if (kind.type === "test") {
    return {
      subject: "EmlakSoft e-posta kanalı testi",
      text: `Merhaba${staffName ? ` ${staffName}` : ""},\n\nBu ileti EmlakSoft yönetim panelinden gönderilen bir test e-postasıdır. Kanal çalışıyor.\n\nEmlakSoft`,
    };
  }
  const vars = SAMPLE_TEMPLATE_VARS[kind.key];
  return {
    subject: `[Örnek] ${renderTemplate(kind.subject, vars, { singleLine: true })}`,
    text: renderTemplate(kind.body, vars),
  };
}

/**
 * Personelin KENDİ adresine gönderir. İmza bilinçli olarak alıcı almaz: `staff.email` dışında hedef yoktur.
 */
export async function sendSelfEmail(staff: { email: string; full_name?: string | null }, kind: SelfSendKind): Promise<EmailSendResult> {
  const to = (staff.email ?? "").trim();
  if (!to) return { ok: false, code: "invalid", error: "Oturumdaki personelin e-posta adresi yok." };
  if (kind.type === "template" && !EMAIL_TEMPLATES.some((t) => t.key === kind.key)) {
    return { ok: false, code: "invalid", error: "Bilinmeyen şablon." };
  }
  const { subject, text } = buildSelfEmail(kind, staff.full_name ?? "");
  return sendEmail({ to, subject, text });
}
