/**
 * Büyüme / atıf: saf (yan etkisiz, sunucu-istemci ortak) yardımcılar.
 *
 * KVKK ilkesi: yalnız gereken alan saklanır. IP, cihaz izi veya kişisel veri YOKTUR;
 * atıf kodu opaktır (rastgele, kişiyi/ofisi açık etmez). Tek kaynak: bu dosya.
 */

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

export type SignupAttributionInput = {
  touch: RefTouch | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
};

/** Kayıt formu ve çerezden gelen ham değerleri tek kayda indirger. Çerez (ilk dokunuş) forma üstündür. */
export function resolveAttributionInput(args: {
  cookie: string | null | undefined;
  ref: string | null | undefined;
  utm_source: string | null | undefined;
  utm_medium: string | null | undefined;
  utm_campaign: string | null | undefined;
}): SignupAttributionInput {
  return {
    touch: parseRefCookie(args.cookie) ?? parseRefParam(args.ref),
    utm_source: cleanUtm(args.utm_source),
    utm_medium: cleanUtm(args.utm_medium),
    utm_campaign: cleanUtm(args.utm_campaign),
  };
}

/** Anlamlı bir atıf var mı? (yoksa kayıt satırı yazılmaz) */
export function hasAttribution(a: SignupAttributionInput): boolean {
  return Boolean(a.touch || a.utm_source || a.utm_medium || a.utm_campaign);
}

/** Davet bağlantısı (mutlak): opak kod. */
export function buildReferralUrl(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/kayit?ref=${encodeURIComponent(code)}`;
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
