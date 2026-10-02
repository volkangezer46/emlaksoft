// ---------------------------------------------------------------------------
// OpenAI'ya giden metinlerde kişisel TANIMLAYICI veri maskeleme (KVKK m.9).
//
// Kapsam: telefon, TC kimlik no (algoritma doğrulamalı), e-posta, IBAN (TR),
// kart numarası (Luhn doğrulamalı). Ad-soyad maskeleme varsayılan KAPALI;
// yalnız çağıran bilinen isimleri `names` ile verirse devreye girer.
//
// Yer tutucular deterministiktir: aynı değer aynı çağrıda hep aynı token'ı alır
// ([TELEFON_1]). Geri çevirme tablosu yalnız bellekte (Redactor örneği) tutulur;
// hiçbir yere yazılmaz/loglanmaz. Saf modül: ağ/DB yok.
// ---------------------------------------------------------------------------

export type RedactKind = "TELEFON" | "TC_KIMLIK" | "E_POSTA" | "IBAN" | "KART" | "KISI";

export type RedactCounts = Partial<Record<RedactKind, number>>;

const TOKEN_RE = /\[(TELEFON|TC_KIMLIK|E_POSTA|IBAN|KART|KISI)_(\d+)\]/g;

/** TC kimlik no doğrulaması: 11 hane, ilk hane 0 değil, iki sağlama hanesi. */
export function isValidTcKimlik(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const d = value.split("").map(Number);
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  if (tenth !== d[9]) return false;
  const sum = d.slice(0, 10).reduce((a, b) => a + b, 0);
  return sum % 10 === d[10];
}

/** Luhn sağlaması (kart numarası). */
export function passesLuhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (dbl) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const SEP = "[\\s.\\-]?";
const SEVEN = `\\d(?:${SEP}\\d){6}`;

// Sıra önemli: önce uzun/yapısal olanlar (IBAN, e-posta, kart), sonra TC, en son telefon.
const IBAN_RE = /(?<![A-Za-z0-9])TR\d{2}(?:\s?\d{4}){5}\s?\d{2}(?!\d)/gi;
const EMAIL_RE = /[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9\-]{1,63}(?:\.[A-Za-z0-9\-]{1,63}){0,6}\.[A-Za-z]{2,24}/g;
const CARD_RE = /(?<![\d.,])\d(?:[ \-]?\d){14,18}(?!\d)/g;
const TC_RE = /(?<!\d[.,]?)[1-9]\d{10}(?!\d|[.,]\d)/g;
const PHONE_RES: RegExp[] = [
  // +90 / 0090 öneki
  new RegExp(`(?<![\\d+])(?:\\+|00)\\s?90[\\s.\\-]?\\(?0?\\)?[\\s.\\-]?\\(?[2-5]\\d{2}\\)?${SEP}${SEVEN}(?!\\d)`, "g"),
  // başında 0
  new RegExp(`(?<![\\d+.,])\\(?0${SEP}\\(?[2-5]\\d{2}\\)?${SEP}${SEVEN}(?![\\d]|[.,]\\d)`, "g"),
  // 90 ile başlayan bitişik 12 hane (905321234567)
  /(?<![\d+.,])90[2-5]\d{9}(?![\d]|[.,]\d)/g,
  // başında 0/+90 olmayan cep numarası (5xx xxx xx xx)
  new RegExp(`(?<![\\d+.,])5[0-6]\\d${SEP}${SEVEN}(?![\\d]|[.,]\\d)`, "g"),
];

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type RedactorOptions = {
  /** Bilinen ad-soyadlar. Boşsa ad maskeleme yapılmaz (varsayılan). */
  names?: string[];
};

/**
 * Tek bir AI çağrısı (veya konuşma turu) boyunca durum tutan maskeleyici.
 * Aynı örnek hem istek maskelemede hem yanıt geri çevirmede kullanılır.
 */
export class Redactor {
  private readonly forward = new Map<string, string>(); // `${kind}:${norm}` → token
  private readonly reverse = new Map<string, string>(); // token → ilk görülen orijinal
  private readonly counters: Record<string, number> = {};
  private readonly nameRes: RegExp[] = [];
  readonly counts: RedactCounts = {};

  constructor(options: RedactorOptions = {}) {
    const names = (options.names ?? [])
      .map((n) => n.trim())
      .filter((n) => n.length >= 3)
      .sort((a, b) => b.length - a.length);
    for (const n of names) {
      this.nameRes.push(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(n)}(?![\\p{L}\\p{N}])`, "giu"));
    }
  }

  private token(kind: RedactKind, norm: string, original: string): string {
    const key = `${kind}:${norm}`;
    const existing = this.forward.get(key);
    if (existing) {
      this.counts[kind] = (this.counts[kind] ?? 0) + 1;
      return existing;
    }
    const n = (this.counters[kind] = (this.counters[kind] ?? 0) + 1);
    const tok = `[${kind}_${n}]`;
    this.forward.set(key, tok);
    this.reverse.set(tok, original);
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;
    return tok;
  }

  /** Metindeki tanımlayıcı verileri yer tutucuyla değiştirir. */
  redactText(input: string): string {
    if (!input) return input;
    let text = input;

    text = text.replace(IBAN_RE, (m) => this.token("IBAN", m.replace(/\s/g, "").toUpperCase(), m));
    text = text.replace(EMAIL_RE, (m) => this.token("E_POSTA", m.toLowerCase(), m));
    text = text.replace(CARD_RE, (m) => {
      const d = digitsOnly(m);
      if (d.length < 15 || d.length > 19 || !passesLuhn(d)) return m;
      return this.token("KART", d, m);
    });
    text = text.replace(TC_RE, (m) => (isValidTcKimlik(m) ? this.token("TC_KIMLIK", m, m) : m));
    for (const re of PHONE_RES) {
      text = text.replace(re, (m) => this.token("TELEFON", digitsOnly(m).slice(-10), m));
    }
    for (const re of this.nameRes) {
      text = text.replace(re, (m) => this.token("KISI", m.toLocaleLowerCase("tr-TR"), m));
    }
    return text;
  }

  /** Yanıttaki yer tutucuları orijinal değerlerine çevirir (yalnız bellekte). */
  restoreText(input: string): string {
    if (!input || this.reverse.size === 0) return input;
    return input.replace(TOKEN_RE, (m) => this.reverse.get(m) ?? m);
  }

  /** Bu örnek herhangi bir değeri maskeledi mi? */
  get redactedTotal(): number {
    return Object.values(this.counts).reduce((a, b) => a + (b ?? 0), 0);
  }

  /**
   * JSON benzeri yapıyı derinlemesine maskeler. `image_url` alt ağaçları
   * (görsel baytları/URL) metin olmadığı için dokunulmadan geçer.
   */
  redactDeep<T>(value: T): T {
    return this.walk(value, (s) => this.redactText(s)) as T;
  }

  restoreDeep<T>(value: T): T {
    return this.walk(value, (s) => this.restoreText(s)) as T;
  }

  private walk(value: unknown, fn: (s: string) => string): unknown {
    if (typeof value === "string") return fn(value);
    if (Array.isArray(value)) return value.map((v) => this.walk(v, fn));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = k === "image_url" ? v : this.walk(v, fn);
      }
      return out;
    }
    return value;
  }

  /** Akış (stream) yanıtları için parça sınırında bölünmüş token'ları da çeviren geri çevirici. */
  createStreamRestorer(): StreamRestorer {
    return new StreamRestorer((s) => this.restoreText(s));
  }
}

/**
 * Akış parçalarında `[TELEFON_1]` gibi token'lar bölünebilir; sonda açık bir
 * `[` varsa (ve makul uzunluktaysa) bir sonraki parçaya kadar bekletilir.
 */
export class StreamRestorer {
  private pending = "";
  private static readonly MAX_PENDING = 24;

  constructor(private readonly restore: (s: string) => string) {}

  push(chunk: string): string {
    const text = this.pending + chunk;
    const open = text.lastIndexOf("[");
    if (open !== -1 && text.indexOf("]", open) === -1 && text.length - open <= StreamRestorer.MAX_PENDING) {
      this.pending = text.slice(open);
      return this.restore(text.slice(0, open));
    }
    this.pending = "";
    return this.restore(text);
  }

  flush(): string {
    const rest = this.pending;
    this.pending = "";
    return this.restore(rest);
  }
}
