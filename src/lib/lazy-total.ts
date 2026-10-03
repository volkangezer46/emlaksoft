/**
 * Tavanlı listelerde (`.limit(N)` + ListLimitNotice) gerçek toplam YALNIZ liste
 * tavana dayandığında gerekir. `count: "exact"` her açılışta tam sayım yaptırır
 * (büyük tenant'ta pahalı); bu yardımcı sayımı yalnız gerektiğinde çalıştırır.
 *
 * Doğruluk: satır sayısı tavandan azsa toplam = `offset + rows` KESİNDİR (sahte
 * kesinlik yok). Tavana ulaşıldıysa `count` geri-çağrısı gerçek (exact) sayımı yapar.
 */
export async function resolveLazyTotal(args: {
  /** Atlanan satır sayısı (tavanlı listede 0). */
  offset?: number;
  /** Çekilen satır sayısı. */
  rows: number;
  /** Sorgudaki tavan / sayfa boyutu. */
  limit: number;
  /** Aynı filtrelerle head-count sorgusu (yalnız tavana dayanınca çağrılır). */
  count: () => PromiseLike<number | null | undefined>;
}): Promise<number | null> {
  const offset = args.offset ?? 0;
  if (args.rows < args.limit && (args.rows > 0 || offset === 0)) {
    return offset + args.rows;
  }
  const c = await args.count();
  return c ?? null;
}
