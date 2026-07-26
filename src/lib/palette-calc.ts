/**
 * Palet hesap makinesi — komut paletine yazılan matematiksel ifadeleri
 * GÜVENLİ biçimde değerlendirir. eval/Function KULLANILMAZ: el yazımı
 * tokenizer + recursive descent parser.
 *
 * Desteklenenler:
 * - + - * / % ( ) ve × ÷
 * - TR sayı biçimi: 5.400.000 (binlik nokta) ve 5,5 (virgül ondalık)
 * - Emlak yüzde kısayolu: "%2 5400000" veya "5400000 %2" → 108.000 (komisyon)
 * - Yüzde ekleme: "150000 + 20%" → 180.000 (KDV mantığı)
 *
 * Yalın sayı ("5400000") BİLEREK hesaplanmaz — ilan no / telefon araması
 * olabilir; palet aramayı bozmamalı. Yan yana iki düz sayı ("12 34") da
 * geçersiz sayılır, null döner.
 */

export type PaletteCalc = {
  /** Ham sonuç (6 ondalığa yuvarlanmış) */
  value: number;
  /** tr-TR biçimli sonuç: "108.000" — panoya bu kopyalanır */
  display: string;
  /** tr-TR TRY biçimli sonuç: "₺108.000" */
  currency: string;
};

type Tok =
  | { t: "num"; v: number; pct: boolean }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "mod" }
  | { t: "(" }
  | { t: ")" };

/** Parser içi değer: pct=true ise "p" henüz yüzdeye çevrilmemiş yüzde sayısı */
type Val = { v: number; pct: boolean };

const NUM_FMT = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
const TRY_FMT = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 2,
});

/**
 * TR sayı biçimini çözer: "5.400.000" → 5400000, "5,5" → 5.5, "5.5" → 5.5.
 * Nokta yalnızca geçerli binlik gruplama (^\d{1,3}(\.\d{3})+$) veya tek
 * ondalık nokta olarak kabul edilir; aksi halde null.
 */
function parseTrNumber(raw: string): number | null {
  if (!/^[\d.,]+$/.test(raw)) return null;
  const commaCount = raw.split(",").length - 1;
  if (commaCount > 1) return null;

  let intPart = raw;
  let fracPart = "";
  if (commaCount === 1) {
    const [a, b] = raw.split(",") as [string, string];
    intPart = a;
    fracPart = b;
    if (fracPart.length === 0 || fracPart.includes(".")) return null;
  }

  if (intPart.includes(".")) {
    if (/^\d{1,3}(\.\d{3})+$/.test(intPart)) {
      intPart = intPart.replace(/\./g, ""); // binlik ayırıcı
    } else if (commaCount === 0 && /^\d+\.\d+$/.test(intPart)) {
      // "5.5" gibi geçersiz gruplama + tek nokta: ondalık kabul et
      const n = Number(intPart);
      return Number.isFinite(n) ? n : null;
    } else {
      return null;
    }
  }
  if (intPart.length === 0) return null;
  const n = Number(fracPart ? `${intPart}.${fracPart}` : intPart);
  return Number.isFinite(n) ? n : null;
}

function tokenize(input: string): Tok[] | null {
  const s = input.replace(/×/g, "*").replace(/÷/g, "/");
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "(" || ch === ")") {
      toks.push({ t: ch });
      i += 1;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      toks.push({ t: "op", v: ch });
      i += 1;
      continue;
    }
    if (ch === "%") {
      // "%2" → yüzde literali; "10 % 3" → mod işleci
      const m = /^\d[\d.,]*/.exec(s.slice(i + 1));
      if (m) {
        const n = parseTrNumber(m[0].replace(/[.,]+$/, ""));
        if (n === null) return null;
        toks.push({ t: "num", v: n, pct: true });
        i += 1 + m[0].length;
        continue;
      }
      toks.push({ t: "op", v: "mod" });
      i += 1;
      continue;
    }
    if (/\d/.test(ch)) {
      const m = /^\d[\d.,]*/.exec(s.slice(i))!;
      const n = parseTrNumber(m[0].replace(/[.,]+$/, ""));
      if (n === null) return null;
      i += m[0].length;
      let pct = false;
      if (s[i] === "%") {
        pct = true; // "20%" son eki
        i += 1;
      }
      toks.push({ t: "num", v: n, pct });
      continue;
    }
    return null;
  }
  return toks;
}

/** pct değeri bağlamsız kullanılırsa kesire çevrilir: 10% → 0,1 */
function resolve(x: Val): number {
  return x.pct ? x.v / 100 : x.v;
}

/** Recursive descent: expr → term → unary → postfix → primary */
function parseTokens(toks: Tok[]): Val | null {
  let pos = 0;
  const peek = () => toks[pos];

  function primary(): Val | null {
    const t = toks[pos];
    pos += 1;
    if (!t) return null;
    if (t.t === "num") return { v: t.v, pct: t.pct };
    if (t.t === "(") {
      const v = expr();
      if (v === null) return null;
      const close = toks[pos];
      pos += 1;
      if (!close || close.t !== ")") return null;
      return { v: resolve(v), pct: false };
    }
    return null;
  }

  // Yan yana sayı + yüzde: "5400000 %2" / "%2 5400000" → yüzde hesabı
  function postfix(): Val | null {
    const first = primary();
    if (first === null) return null;
    const nxt = peek();
    if (nxt && nxt.t === "num" && nxt.pct !== first.pct) {
      pos += 1;
      const base = first.pct ? nxt.v : first.v;
      const p = first.pct ? first.v : nxt.v;
      return { v: (base * p) / 100, pct: false };
    }
    return first;
  }

  function unary(): Val | null {
    const t = peek();
    if (t && t.t === "op" && (t.v === "+" || t.v === "-")) {
      pos += 1;
      const v = unary();
      if (v === null) return null;
      return { v: t.v === "-" ? -v.v : v.v, pct: v.pct };
    }
    return postfix();
  }

  function term(): Val | null {
    let left = unary();
    if (left === null) return null;
    for (;;) {
      const t = peek();
      if (!t || t.t !== "op" || (t.v !== "*" && t.v !== "/" && t.v !== "mod")) break;
      pos += 1;
      const right = unary();
      if (right === null) return null;
      const a = resolve(left);
      const b = resolve(right);
      const v = t.v === "*" ? a * b : t.v === "/" ? a / b : a % b;
      left = { v, pct: false };
    }
    return left;
  }

  function expr(): Val | null {
    let left = term();
    if (left === null) return null;
    for (;;) {
      const t = peek();
      if (!t || t.t !== "op" || (t.v !== "+" && t.v !== "-")) break;
      pos += 1;
      const right = term();
      if (right === null) return null;
      if (right.pct && !left.pct) {
        // "100 + 10%" → 110; "180000 - 20%" → 144000
        const delta: number = (left.v * right.v) / 100;
        left = { v: t.v === "+" ? left.v + delta : left.v - delta, pct: false };
      } else {
        const a = resolve(left);
        const b = resolve(right);
        left = { v: t.v === "+" ? a + b : a - b, pct: false };
      }
    }
    return left;
  }

  const out = expr();
  if (out === null || pos < toks.length) return null;
  return out;
}

/**
 * Palet girdisini değerlendirir; matematiksel bir ifade değilse null döner
 * (arama akışı bozulmaz). Sıfıra bölme / bozuk ifade de null'dur.
 */
export function evaluatePaletteInput(input: string): PaletteCalc | null {
  const s = input.trim();
  if (s.length === 0) return null;
  // Yalnızca rakam/işleç/ayırıcı/parantez/boşluk içermeli
  if (!/^[\d\s+\-*/%().,×÷]+$/.test(s)) return null;
  if (!/\d/.test(s)) return null;
  // İşleçsiz yalın sayı hesap değildir (ilan no araması olabilir)
  if (!/[+\-*/%×÷]/.test(s)) return null;

  const toks = tokenize(s);
  if (!toks || toks.length === 0) return null;
  const val = parseTokens(toks);
  if (val === null) return null;

  const value = resolve(val);
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value * 1e6) / 1e6;
  return {
    value: rounded,
    display: NUM_FMT.format(rounded),
    currency: TRY_FMT.format(rounded),
  };
}
