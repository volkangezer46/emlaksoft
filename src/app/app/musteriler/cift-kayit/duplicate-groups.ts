/**
 * Aynı kişiler ekranının SAF gruplama çekirdeği (sunucu sayfası kullanır; test edilebilir).
 *
 * - Satırlar (sinyal + eşleşme anahtarı) ile gruplanır; güçlü sinyal önce (telefon → e-posta → ad).
 * - Daha zayıf sinyalli bir grubun kayıt kümesi, daha önce listelenen güçlü bir grubun alt kümesiyse grup DÜŞER:
 *   aynı iki kayıt hem "Aynı telefon" hem "Aynı ad soyad" altında iki kez birleştirme önermesin.
 * - Görünen başlık (`label`): ad sinyalinde normalize anahtar ("[saha] vg ayse demir") yerine kaydın gerçek adı.
 */

export type DuplicateSignal = "phone" | "email" | "name";

export type DuplicateRow = {
  signal: DuplicateSignal;
  match_key: string;
  customer_id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
  assigned_to: string | null;
  activity: number;
};

export type DuplicateRowGroup = { signal: DuplicateSignal; key: string; label: string; kayitlar: DuplicateRow[] };

const RANK: Record<DuplicateSignal, number> = { phone: 0, email: 1, name: 2 };

export function groupDuplicateRows(rows: readonly DuplicateRow[]): DuplicateRowGroup[] {
  const byKey = new Map<string, { signal: DuplicateSignal; key: string; kayitlar: DuplicateRow[] }>();
  for (const r of rows) {
    const k = `${r.signal}::${r.match_key}`;
    let g = byKey.get(k);
    if (!g) {
      g = { signal: r.signal, key: r.match_key, kayitlar: [] };
      byKey.set(k, g);
    }
    // Aynı kayıt aynı grupta iki kez gelmesin (SQL birleşimi tekrar üretse bile).
    if (!g.kayitlar.some((x) => x.customer_id === r.customer_id)) g.kayitlar.push(r);
  }
  // Kararlı sıralama: sinyal gücü, sonra SQL'in verdiği sıra.
  const ordered = [...byKey.values()]
    .map((g, i) => ({ g, i }))
    .sort((a, b) => RANK[a.g.signal] - RANK[b.g.signal] || a.i - b.i)
    .map(({ g }) => g)
    .filter((g) => g.kayitlar.length > 1);

  const kept: DuplicateRowGroup[] = [];
  for (const g of ordered) {
    const ids = new Set(g.kayitlar.map((k) => k.customer_id));
    const covered = kept.some((s) => RANK[s.signal] < RANK[g.signal] && [...ids].every((id) => s.kayitlar.some((k) => k.customer_id === id)));
    if (covered) continue;
    const label = g.signal === "name" ? (g.kayitlar.find((k) => k.full_name?.trim())?.full_name?.trim() ?? g.key) : g.key;
    kept.push({ ...g, label });
  }
  return kept;
}
