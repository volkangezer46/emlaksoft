import { redirect } from "next/navigation";

/**
 * "Demo & aday" bölümü kaldırıldı: ofisler kendisi kayıt olup paket alıyor (demo talebi, uzaktan sunum ve aday
 * takibi yok). Eski bağlantılar self-servis deneme hunisine gider. `demo_requests` tablosu ve verisi DEĞİŞMEDİ.
 */
export default function LegacySalesPage(): never {
  redirect("/admin/tenants?durum=trial");
}
