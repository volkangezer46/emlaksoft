"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/require-permission";
import { dismissLostSaleRisk } from "../kayip-satis/actions";

/**
 * Akıllı listelerdeki "Kaybedilme riski yüksek" bölümünden Arandı / 1 hafta ertele.
 * Asıl iş (erteleme hafızası `lost_sale_dismissals`, isteğe bağlı çağrı kaydı, etkinlik günlüğü)
 * `kayip-satis/actions.ts` içindeki TEK eylemde yapılır; burada yalnız yetki kapısı ve bu sayfanın tazelenmesi vardır.
 */
export async function dismissRiskFromSmartList(formData: FormData): Promise<void> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return;
  await dismissLostSaleRisk(formData);
  revalidatePath("/app/akilli-listeler");
}
