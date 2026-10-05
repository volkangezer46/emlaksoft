/**
 * ÖRNEK rapor kartı: tamamen statik ve KURGUSALDIR. Gerçek mahalle, ada/parsel, değer veya emsal verisi iddiası yoktur;
 * "ÖRNEK" damgalıdır. Sahte skor/istatistik yerine raporun hangi alanlardan oluştuğunu gösterir: değer aralığı bandı ve
 * 3 segmentli güven düzeyi göstergesi (hareket açıkken bir kez çizilir/dolar; temel CSS = son kare; marketing-motion.css).
 */
export function ExampleReport({ className = "" }: { className?: string }) {
  const row = (label: string, value: string) => (
    <div className="mk-rep-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
  return (
    <figure className={`mk-rep mk-reveal ${className}`.trim()} aria-label="Örnek değerleme raporu önizlemesi (kurgusal)">
      <span className="mk-tag mk-example" data-example-stamp>ÖRNEK</span>
      <figcaption>Kurgusal gösterim; gerçek bir parsel veya sonuç değildir.</figcaption>
      <dl>
        {row("Mahalle", "Örnek Mahalle")}
        {row("Ada / Parsel", "000 / 0 (örnek)")}
        {row("Değer aralığı", "0,0 – 0,0 milyon ₺ (örnek)")}
      </dl>
      <div className="mk-rep-band" role="img" aria-label="Örnek değer aralığı bandı: alt sınır, orta ve üst sınır">
        <div className="mk-rep-track">
          <i className="mk-a-fillx" />
          <b className="mk-a-pop" />
        </div>
        <div className="mk-rep-scale" aria-hidden="true"><span>alt sınır</span><span>orta</span><span>üst sınır</span></div>
      </div>
      <dl>
        {row("Kullanılan emsal sayısı", "00 (örnek)")}
        <div className="mk-rep-row">
          <dt>Güven düzeyi</dt>
          <dd>
            <span className="mk-rep-conf" role="img" aria-label="Güven düzeyi: Orta (örnek), üç kademeden ikisi dolu">
              <i className="mk-a-pop" style={{ "--i": 0 } as React.CSSProperties} />
              <i className="mk-a-pop" style={{ "--i": 1 } as React.CSSProperties} />
              <i />
            </span>
            Orta (örnek)
          </dd>
        </div>
      </dl>
      <p className="mk-rep-note">
        Gerçek raporda aynı alanlar seçtiğiniz ada/parselin EmlakFiyati verisiyle dolar ve PDF olarak indirilebilir.
      </p>
    </figure>
  );
}
