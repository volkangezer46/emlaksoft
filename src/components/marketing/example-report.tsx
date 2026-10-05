/**
 * ÖRNEK rapor önizlemesi: tamamen statik ve KURGUSALDIR. Gerçek mahalle, ada/parsel, değer veya emsal verisi iddiası yoktur;
 * her alan "örnek" damgalıdır. Sahte skor/istatistik yerine yalnız raporun hangi alanlardan oluştuğunu gösterir.
 */
export function ExampleReport() {
  const row = (label: string, value: string) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 text-sm last:border-b-0">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-right font-semibold tabular-nums text-ink-950">{value}</dd>
    </div>
  );
  return (
    <figure
      className="relative overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface p-5"
      aria-label="Örnek değerleme raporu önizlemesi (kurgusal)"
    >
      <span className="mk-tag mk-example" data-example-stamp>ÖRNEK</span>
      <figcaption className="mt-3 text-xs text-text-muted">Kurgusal gösterim; gerçek bir parsel veya sonuç değildir.</figcaption>
      <dl className="mt-2">
        {row("Mahalle", "Örnek Mahalle")}
        {row("Ada / Parsel", "000 / 0 (örnek)")}
        {row("Değer aralığı", "0,0 – 0,0 milyon ₺ (örnek)")}
        {row("Kullanılan emsal sayısı", "00 (örnek)")}
        {row("Güven düzeyi", "Orta (örnek)")}
      </dl>
      <p className="mt-3 text-xs text-text-muted">
        Gerçek raporda aynı alanlar seçtiğiniz ada/parselin EmlakFiyati verisiyle dolar ve PDF olarak indirilebilir.
      </p>
    </figure>
  );
}
