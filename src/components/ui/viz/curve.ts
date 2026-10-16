/**
 * Eğri ve eksen yardımcıları — SAF, bağımlılıksız (sunucu grafikleri ve istemci grafikleri aynı kodu kullanır; istemci
 * paketine yalnız bu birkaç fonksiyon girer). Birim testli (`server-charts.test.ts`).
 */

/**
 * Monoton kübik eğri (Fritsch–Carlson / d3 `curveMonotoneX` eşdeğeri): noktalardan geçer, iki nokta arasında
 * aşma yapmaz (alan sıfırın altına sarkmaz, tepe uydurulmaz). Saf; test edilir.
 */
export function monotonePath(pts: ReadonlyArray<{ x: number; y: number }>): string {
  const f = (n: number) => n.toFixed(2);
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${f(pts[0]!.x)},${f(pts[0]!.y)}`;
  if (n === 2) return `M${f(pts[0]!.x)},${f(pts[0]!.y)} L${f(pts[1]!.x)},${f(pts[1]!.y)}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]!.x - pts[i]!.x || 1e-6);
    m.push((pts[i + 1]!.y - pts[i]!.y) / dx[i]!);
  }
  const t: number[] = new Array(n).fill(0);
  t[0] = m[0]!;
  t[n - 1] = m[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    const a = m[i - 1]!;
    const b = m[i]!;
    if (a * b <= 0) t[i] = 0;
    else {
      const w1 = 2 * dx[i]! + dx[i - 1]!;
      const w2 = dx[i]! + 2 * dx[i - 1]!;
      t[i] = (w1 + w2) / (w1 / a + w2 / b);
    }
  }
  let d = `M${f(pts[0]!.x)},${f(pts[0]!.y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    const h = dx[i]! / 3;
    d += ` C${f(p.x + h)},${f(p.y + t[i]! * h)} ${f(q.x - h)},${f(q.y - t[i + 1]! * h)} ${f(q.x)},${f(q.y)}`;
  }
  return d;
}

/**
 * Sıfırı zorunlu kılmayan "güzel" eksen aralığı (bakiye gibi düzey serileri için): 1-2-2,5-5 adımlı, uçları kapsar.
 * Seri düzse tek adım açılır. Saf; test edilir.
 */
export function niceRange(min: number, max: number, target = 4): number[] {
  const lo0 = Number.isFinite(min) ? min : 0;
  const hi0 = Number.isFinite(max) ? max : 0;
  const span = hi0 - lo0 || Math.abs(hi0) || 1;
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * pow).find((s) => s >= raw) ?? pow * 10;
  const lo = Math.floor(lo0 / step + 1e-9) * step;
  let hi = Math.ceil(hi0 / step - 1e-9) * step;
  if (hi <= lo) hi = lo + step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 1e6; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}
