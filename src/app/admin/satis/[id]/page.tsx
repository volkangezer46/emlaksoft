import { redirect } from "next/navigation";

/** Eski demo talebi ayrıntısı: bölüm kaldırıldı (bkz. ../page.tsx); self-servis deneme hunisine yönlendirir. */
export default function LegacyLeadDetailPage(): never {
  redirect("/admin/tenants?durum=trial");
}
