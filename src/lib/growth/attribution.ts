/**
 * Büyüme / atıf: saf (yan etkisiz, sunucu-istemci ortak) yardımcılar.
 *
 * KVKK ilkesi: yalnız gereken alan saklanır. IP, cihaz izi veya kişisel veri YOKTUR;
 * atıf kodu opaktır (rastgele, kişiyi/ofisi açık etmez). Reklam ağlarının tıklama kimliği okunmaz ve saklanmaz.
 * Tek kaynak: bu dosya.
 */
import { classifyChannel, cleanHost, type Channel } from "@/lib/measure/channel";
import { pathTemplate } from "@/lib/measure/scope";

/** Birinci taraf atıf çerezi (ilk dokunuş kazanır). */
export const REF_COOKIE = "es_ref";
/** Çerez ömrü (gün). Sabit teknik değerdir; ödül değildir. */
export const REF_COOKIE_DAYS = 30;

export type RefKind = "referral" | "partner" | "powered_by";

/** Ofis davet kodu: opak, 8 karakter (okunurluk için 0/1/i/l/o yok). */
export const REFERRAL_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const REFERRAL_CODE_LENGTH = 8;
const REFERRAL_CODE_RE = /^[a-z0-9]{6,12}$/;
const PARTNER_CODE_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;
const VITRIN_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;

export type RefTouch = { kind: RefKind; code: string };

export function isReferralCode(v: string): boolean {
  return REFERRAL_CODE_RE.test(v);
}
export function isPartnerCode(v: string): boolean {
  return PARTNER_CODE_RE.test(v);
}

/** Çerez değeri: "r:<kod>" (ofis daveti) | "p:<kod>" (ortak) | "v:<slug>" (vitrin imzası). */
export function formatRefCookie(t: RefTouch): string {
  const p = t.kind === "referral" ? "r" : t.kind === "partner" ? "p" : "v";
  return `${p}:${t.code}`;
}

export function parseRefCookie(raw: string | null | undefined): RefTouch | null {
  const v = (raw ?? "").trim().toLowerCase();
  const m = /^([rpv]):([a-z0-9-]{1,60})$/.exec(v);
  if (!m) return null;
  const code = m[2];
  if (m[1] === "r") return isReferralCode(code) ? { kind: "referral", code } : null;
  if (m[1] === "p") return isPartnerCode(code) ? { kind: "partner", code } : null;
  return VITRIN_SLUG_RE.test(code) ? { kind: "powered_by", code } : null;
}

/**
 * Kısa bağlantı yolu çözümleyici: `/r/<x>` için x = "v-<slug>" (vitrin imzası) ya da ofis davet kodu.
 * Tanınmayan değer null döner (çağıran sessizce /kayit'a yönlendirir).
 */
export function parseShortCode(raw: string): RefTouch | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (v.startsWith("v-")) {
    const slug = v.slice(2);
    return VITRIN_SLUG_RE.test(slug) ? { kind: "powered_by", code: slug } : null;
  }
  return isReferralCode(v) ? { kind: "referral", code: v } : null;
}

/** /kayit?ref=<kod> değeri: yalnız ofis davet kodu kabul edilir. */
export function parseRefParam(raw: string | null | undefined): RefTouch | null {
  const v = (raw ?? "").trim().toLowerCase();
  return isReferralCode(v) ? { kind: "referral", code: v } : null;
}

/** UTM alanı: kısa, güvenli karakterler; yoksa null. */
export function cleanUtm(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v || v.length > 64) return null;
  return /^[a-z0-9][a-z0-9._-]*$/.test(v) ? v : null;
}

/** utm_term / utm_content: serbest kısa metin (arama terimi, reklam varyantı). Kontrol karakteri ve <>"\ atılır; ≤64. */
export function cleanUtmText(raw: string | null | undefined): string | null {
  const v = (raw ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("tr-TR");
  if (!v) return null;
  return v.length > 64 ? v.slice(0, 64).trim() || null : v;
}

/**
 * İniş yolu: yalnız ölçüm kapsamındaki herkese açık yol, ŞABLON olarak (vitrin/ilan/danışman parçaları gizlenir;
 * sayaç tablosuyla aynı anahtar) ve ≤120 karakter. Kapsam dışı (/app, /giris, /kayit/tamamla...) ya da uzun yol null.
 */
export function cleanLandingPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length > 120) return null;
  const tpl = pathTemplate(raw);
  return tpl && tpl.length <= 120 ? tpl : null;
}

export type SignupAttributionInput = {
  touch: RefTouch | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  /** İstemcinin taşıdığı ek atıf (yalnız `measure.attribution` açıkken gelir). */
  utm_term?: string | null;
  utm_content?: string | null;
  /** Yönlendiren ana makine ("" = yönlendiren yok, null = bilgi taşınmadı). */
  src_host?: string | null;
  /** İniş yolu şablonu (cleanLandingPath). */
  lp?: string | null;
};

/** Kayıt formu ve çerezden gelen ham değerleri tek kayda indirger. Çerez (ilk dokunuş) forma üstündür. */
export function resolveAttributionInput(args: {
  cookie: string | null | undefined;
  ref: string | null | undefined;
  utm_source: string | null | undefined;
  utm_medium: string | null | undefined;
  utm_campaign: string | null | undefined;
  utm_term?: string | null | undefined;
  utm_content?: string | null | undefined;
  src_host?: string | null | undefined;
  lp?: string | null | undefined;
}): SignupAttributionInput {
  const lp = cleanLandingPath(args.lp);
  const host = cleanHost(args.src_host);
  return {
    touch: parseRefCookie(args.cookie) ?? parseRefParam(args.ref),
    utm_source: cleanUtm(args.utm_source),
    utm_medium: cleanUtm(args.utm_medium),
    utm_campaign: cleanUtm(args.utm_campaign),
    utm_term: cleanUtmText(args.utm_term),
    utm_content: cleanUtmText(args.utm_content),
    // İstemci iniş yolunu taşıdıysa yönlendiren bilgisi de taşınmıştır: boş host = "yönlendiren yok" (doğrudan).
    src_host: host || (lp ? "" : null),
    lp,
  };
}

/** Anlamlı bir atıf var mı? (yalnız bilgi amaçlı: atıfsız kayıtta da satır yazılır, kanal direct/unknown olur) */
export function hasAttribution(a: SignupAttributionInput): boolean {
  return Boolean(a.touch || a.utm_source || a.utm_medium || a.utm_campaign || a.lp || a.src_host);
}

/** İlk/son dokunuş özeti (kişisel veri yok; ≤1 KB). */
export type TouchSummary = {
  channel: Channel;
  ref?: RefKind;
  src_host?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  lp?: string;
};

export type SignupAttributionColumns = {
  channel: Channel;
  src_host: string | null;
  utm_term: string | null;
  utm_content: string | null;
  landing_path: string | null;
  first_touch: TouchSummary;
  last_touch: TouchSummary;
};

function compactTouch(t: TouchSummary): TouchSummary {
  return Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined && v !== "")) as TouchSummary;
}

/**
 * signup_attributions ek sütunları (SAF). Kanal ziyaret sayacıyla AYNI kuralla (classifyChannel) hesaplanır; ofis
 * daveti/ortak/vitrin imzası dokunuşu önceliklidir. İstemci hiç bilgi taşımadıysa (atıf taşıma kapalı: iniş yolu ve
 * yönlendiren yok) kaynak "bilinmiyor" sayılır → `unknown`; taşıdı ama yönlendiren yoksa → `direct`.
 * Son dokunuş = bu oturumun kaynağı (UTM/yönlendiren/iniş yolu); ilk dokunuş = 30 günlük atıf çerezi varsa o, yoksa
 * son dokunuşla aynı. Ödül mantığı bu alanlara BAKMAZ (yalnız ref_kind).
 */
export function signupAttributionColumns(a: SignupAttributionInput): SignupAttributionColumns {
  const base = { refHost: a.src_host ?? null, utm_source: a.utm_source, utm_medium: a.utm_medium };
  const last = compactTouch({
    channel: classifyChannel(base),
    src_host: a.src_host || undefined,
    utm_source: a.utm_source ?? undefined,
    utm_medium: a.utm_medium ?? undefined,
    utm_campaign: a.utm_campaign ?? undefined,
    lp: a.lp ?? undefined,
  });
  const first: TouchSummary = a.touch ? { channel: classifyChannel({ touch: a.touch }), ref: a.touch.kind } : last;
  return {
    channel: classifyChannel({ ...base, touch: a.touch }),
    src_host: a.src_host || null,
    utm_term: a.utm_term ?? null,
    utm_content: a.utm_content ?? null,
    landing_path: a.lp ?? null,
    first_touch: first,
    last_touch: last,
  };
}

/** Vitrin altbilgisi bağlantısı: hangi vitrinin getirdiğini ölçer; ödül vermez. */
export function vitrinSignatureHref(slug: string): string {
  return `/r/v-${slug}`;
}

/** Rastgele opak kod üretir (rnd enjekte edilebilir: test için). */
export function generateReferralCode(rnd: (n: number) => number): string {
  let out = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    out += REFERRAL_CODE_ALPHABET[rnd(REFERRAL_CODE_ALPHABET.length)];
  }
  return out;
}
