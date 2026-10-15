/**
 * Kamu kayıt kısayolları (portföy detayı): TKGM parsel sorgu, AFAD deprem tehlike haritası, DASK poliçe sorgulama.
 *
 * Yalnızca dış bağlantı üretir; hiçbir ağ çağrısı yapmaz, anahtar gerektirmez.
 * TKGM Parsel Sorgu'nun belgelenmiş bir derin bağlantı biçimi yok (adres içindeki mahalle kimliği TKGM'nin kendi
 * kimliğidir, bizim geo kayıtlarımızla eşleşmez) — bu yüzden düz bağlantı + panoya "il/ilçe/mahalle ada/parsel" metni.
 */
export const TKGM_PARSEL_SORGU_URL = "https://parselsorgu.tkgm.gov.tr/";
export const AFAD_TDTH_URL = "https://tdth.afad.gov.tr/";
export const DASK_URL = "https://www.dask.gov.tr/";

export type ParcelInput = {
  province?: string | null;
  district?: string | null;
  neighborhood?: string | null;
  block?: string | null;
  lot?: string | null;
};

const clean = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

/**
 * Panoya kopyalanacak sorgu metni: "İl/İlçe/Mahalle ada/parsel". Ada veya parsel boşsa null (sorgu anlamsız).
 * Konum parçalarından eksik olanlar atlanır.
 */
export function parcelQueryText(input: ParcelInput): string | null {
  const block = clean(input.block);
  const lot = clean(input.lot);
  if (!block || !lot) return null;
  const place = [input.province, input.district, input.neighborhood].map(clean).filter(Boolean).join("/");
  return place ? `${place} ${block}/${lot}` : `${block}/${lot}`;
}
