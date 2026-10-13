import { fetchExternal, externalErrorMetadata, readExternalJson } from "@/lib/external-fetch";
import { emailFromDomain, resolveEmailChannelConfig } from "./provider";
import { composeTemplateEmail, sendLoggedEmail, type LoggedSendResult } from "./send";
import { DEFAULT_EMAIL_FOOTER, isEmailTemplateKey, sampleVars, type EmailTemplateKey } from "./templates";

/**
 * E-posta kanalı denetimi: Resend bağlantı testi (GET /domains, 5 sn) ve personelin KENDİ adresine test/örnek gönderim.
 * Alıcı parametresi YOKTUR: gönderim yalnız oturumdaki personelin e-postasına gider (kötüye kullanımla dışarıya posta
 * atılamaz). Anahtar değeri sonuçlara/loglara girmez. Test gönderimleri de günlüğe yazılır (kaynak "admin_test").
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

export type SenderDnsState = "ok" | "pending" | "failed" | "missing" | "unknown";
export type SenderDnsSummary = { state: SenderDnsState; domain: string | null; spf: string | null; dkim: string | null; text: string };

/** Gönderen alan adının SPF/DKIM rozeti (SAF): bağlantı testi sonucundan tek satırlık durum. */
export function summarizeSenderDns(r: ConnectionTestResult): SenderDnsSummary {
  if (!r.ok) return { state: "unknown", domain: null, spf: null, dkim: null, text: r.error };
  if (!r.fromDomain) return { state: "unknown", domain: null, spf: null, dkim: null, text: "Gönderen adresi tanımlı değil." };
  const d = r.domains.find((x) => x.name.toLowerCase() === r.fromDomain);
  if (!d) return { state: "missing", domain: r.fromDomain, spf: null, dkim: null, text: `${r.fromDomain} Resend hesabında yok; alan adını ekleyip DNS kayıtlarını girin.` };
  const rec = (name: string) => {
    const list = d.records.filter((x) => x.record === name).map((x) => x.status.toLowerCase());
    if (list.length === 0) return null;
    if (list.every((s) => s === "verified")) return "verified";
    return list.some((s) => s === "failed" || s === "temporary_failure") ? "failed" : "pending";
  };
  const spf = rec("SPF");
  const dkim = rec("DKIM");
  const all = [d.status.toLowerCase(), spf, dkim].filter((x): x is string => Boolean(x));
  const state: SenderDnsState = all.every((s) => s === "verified")
    ? "ok"
    : all.some((s) => s === "failed" || s === "temporary_failure")
      ? "failed"
      : "pending";
  const word = (s: string | null) => (s === "verified" ? "doğrulandı" : s === "failed" ? "başarısız" : s ? "bekliyor" : "okunamadı");
  return { state, domain: d.name, spf, dkim, text: `${d.name}: SPF ${word(spf)} · DKIM ${word(dkim)}` };
}

export type SelfSendKind = { type: "test" } | { type: "template"; key: EmailTemplateKey; subject: string; body: string; footer?: string };

/** Gönderilecek konu/metin/HTML (SAF). Şablon örneği "[Örnek]" önekiyle ve katalogdaki örnek değerlerle hazırlanır. */
export function buildSelfEmail(kind: SelfSendKind, staffName: string): { subject: string; text: string; html?: string; template: string } {
  if (kind.type === "test") {
    return {
      subject: "EmlakSoft e-posta kanalı testi",
      text: `Merhaba${staffName ? ` ${staffName}` : ""},\n\nBu ileti EmlakSoft yönetim panelinden gönderilen bir test e-postasıdır. Kanal çalışıyor.\n\nEmlakSoft`,
      template: "test",
    };
  }
  const mail = composeTemplateEmail(
    kind.key,
    { subject: kind.subject, body: kind.body, footer: kind.footer ?? DEFAULT_EMAIL_FOOTER },
    sampleVars(kind.key),
  );
  return { subject: `[Örnek] ${mail.subject}`, text: mail.text, html: mail.html, template: kind.key };
}

/**
 * Personelin KENDİ adresine gönderir (günlüklü: `sendLoggedEmail`, kaynak "admin_test"). İmza bilinçli olarak alıcı
 * almaz: `staff.email` dışında hedef yoktur.
 */
export async function sendSelfEmail(
  staff: { id?: string; email: string; full_name?: string | null },
  kind: SelfSendKind,
): Promise<LoggedSendResult> {
  const to = (staff.email ?? "").trim();
  if (!to) return { ok: false, code: "invalid", error: "Oturumdaki personelin e-posta adresi yok." };
  if (kind.type === "template" && !isEmailTemplateKey(kind.key)) {
    return { ok: false, code: "invalid", error: "Bilinmeyen şablon." };
  }
  const { subject, text, html, template } = buildSelfEmail(kind, staff.full_name ?? "");
  return sendLoggedEmail({ to, subject, text, html, template, source: "admin_test", actorId: staff.id ?? null });
}
