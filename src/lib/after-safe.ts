import { after } from "next/server";

/**
 * Yanıt gönderildikten SONRA çalışan yan etki (audit, otomasyon, iş akışı). `after()` içinde yakalanmamış hata
 * sessizce kaybolur; bu sarmalayıcı hatayı her durumda günlüğe yazar ve asla fırlatmaz (ana işlem zaten tamamlandı).
 * Görev eşzamanlı fırlatsa da, reddedilen Promise döndürse de aynı şekilde yakalanır.
 */
export function afterSafe(task: () => unknown, label = "yan etki"): void {
  after(async () => {
    try {
      await task();
    } catch (e) {
      console.error("after() yan etkisi başarısız", label, e instanceof Error ? e.message : e);
    }
  });
}
