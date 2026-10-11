/**
 * Ekstre içe aktarmada kullanıcıya gösterilen başarısızlık nedenleri (SAF; istemci ve sunucu paylaşır, bağımlılığı yok).
 * Amaç: "işlenemedi" gibi nedensiz mesaj yerine biçim, boyut, sütun eşleme, mükerrer ve tarih/yetki nedenlerini açıkça söylemek.
 */

export const STATEMENT_MAX_BYTES = 2 * 1024 * 1024;
const SIZE_MESSAGE = "Dosya en çok 2 MB olabilir. Ekstreyi daha kısa bir tarih aralığıyla indirip tekrar deneyin.";

/** Yüklemeden ÖNCE tarayıcıda: boyut ve uzantı kontrolü (null = sorun yok). */
export function precheckStatementFile(file: { name: string; size: number }): string | null {
  if (file.size === 0) return "Dosya boş görünüyor. Bankanın indirdiği ekstreyi değiştirmeden yükleyin.";
  if (file.size > STATEMENT_MAX_BYTES) return SIZE_MESSAGE;
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xls")) return "Eski .xls biçimi desteklenmiyor. Dosyayı Excel'de .xlsx veya .csv olarak kaydedip yükleyin.";
  if (!/\.(csv|xlsx|ofx)$/.test(lower)) return "Yalnız .csv, .xlsx veya .ofx ekstre dosyası yüklenebilir.";
  return null;
}

/** Ekstre ucundan gelen JSON olmayan ya da hata durumlu yanıtın kullanıcı mesajı. `bodyError` sunucunun kendi (Türkçe) mesajıdır. */
export function statementTransportError(status: number, bodyError: string | null): string {
  if (bodyError) return bodyError;
  if (status === 413) return SIZE_MESSAGE;
  if (status === 401) return "Oturum bulunamadı. Yeniden giriş yapın.";
  if (status === 403) return "İstek doğrulanamadı. Sayfayı yenileyip tekrar deneyin.";
  if (status === 408 || status === 504) return "Dosya zamanında işlenemedi. Daha kısa bir tarih aralığıyla tekrar deneyin.";
  if (status === 429) return "Çok sık deneme yapıldı. Bir dakika sonra tekrar deneyin.";
  if (status >= 500) return "Sunucu şu an yanıt veremedi. Birkaç dakika sonra tekrar deneyin.";
  return "Dosya okunamadı. Tekrar deneyin.";
}

export type ApplyFailureInput = {
  decisions: readonly { lineId: string; action: string; category?: string | null }[];
  lines: ReadonlyMap<string, { date: string; direction: "in" | "out" }>;
  /** Hesabın açılış tarihi (YYYY-MM-DD) ve bugün (TR günü). */
  openingDate: string | null;
  today: string;
  /** Ofis hesabında "maaş" kategorisi yalnız sahip/genel müdüre açıktır. */
  canBookSalary: boolean;
  isOfficeAccount: boolean;
};

/** Hangi karar neden büyük olasılıkla reddedilir: nedenleri sayarak insan cümlesine çevirir (boşsa genel ipucu). */
export function explainApplyFailures(input: ApplyFailureInput, failed: number): string {
  let beforeOpening = 0;
  let future = 0;
  let salary = 0;
  for (const d of input.decisions) {
    if (d.action !== "create") continue;
    const line = input.lines.get(String(d.lineId));
    if (!line) continue;
    if (input.openingDate && line.date < input.openingDate) beforeOpening++;
    else if (line.date > input.today) future++;
    else if (d.category === "maas" && input.isOfficeAccount && !input.canBookSalary) salary++;
  }
  const reasons: string[] = [];
  if (beforeOpening) reasons.push(`${beforeOpening} satırın tarihi hesabın açılış tarihinden önce`);
  if (future) reasons.push(`${future} satırın tarihi bugünden sonra`);
  if (salary) reasons.push(`${salary} satır maaş kategorisinde (yalnız ofis sahibi/genel müdür ekleyebilir)`);
  const head = `${failed} satır işlenemedi`;
  if (reasons.length === 0) {
    return `${head}: kategori, yetki, hesap durumu veya eşleştirilen kaydın başka bir hesaba bağlı olması nedeniyle reddedilmiş olabilir.`;
  }
  return `${head}: ${reasons.join("; ")}.`;
}
