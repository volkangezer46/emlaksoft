"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { now } from "@/lib/clock";
import { cleanPresenceNote, effectivePresence, isPresenceStatus, shouldAutoField } from "@/lib/presence";

/**
 * EKİP DURUMU — kullanıcının KENDİ durumu (Ofiste / Mola / Uzakta / Sahada / Görüşmede / Çevrimdışı). Hedef daima
 * oturumdaki kullanıcıdır (parametrede kişi yok). Yetki: her aktif ofis üyesi (`dashboard:view`); destek (bürünme)
 * oturumu yazamaz (kapı + RLS). `updated_at` DB tetiğinde `now()` olur. Tablo yoksa (migration bekliyor) "henüz etkin değil".
 */
export type PresenceResult = { ok: true } | { ok: false; error: string };

const MISSING = new Set(["42P01", "PGRST205"]);

async function gate() {
  const g = await requirePermission("dashboard", "view");
  if (!g.ok) return { error: g.error } as const;
  if (g.impersonating) return { error: "Destek oturumunda durum değiştirilemez." } as const;
  return { userId: g.userId, tenantId: g.tenantId } as const;
}

export async function setMyPresence(status: string, note?: string | null): Promise<PresenceResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error ?? "Yetki yok." };
  if (!isPresenceStatus(status)) return { ok: false, error: "Geçersiz durum." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("user_presence")
    .upsert({ user_id: g.userId, tenant_id: g.tenantId, status, note: cleanPresenceNote(note) }, { onConflict: "user_id" });
  if (error) {
    if (MISSING.has(error.code ?? "")) return { ok: false, error: "Ekip durumu henüz etkin değil." };
    console.error("setMyPresence", { code: error.code });
    return { ok: false, error: "Durum kaydedilemedi; bağlantınızı kontrol edip yeniden deneyin." };
  }
  revalidatePath("/app", "layout");
  return { ok: true };
}

/** Saha modu (/app/hızlı) açılınca: bugün seçilmiş durum yoksa ya da Ofiste/Çevrimdışı ise "Sahada" (sessiz; hata yutulur). */
export async function markFieldPresence(): Promise<PresenceResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error ?? "Yetki yok." };
  const supabase = await createClient();
  const cur = await supabase.from("user_presence").select("status, note, updated_at, is_sample").eq("user_id", g.userId).maybeSingle();
  if (cur.error) return { ok: false, error: "Durum okunamadı; sayfayı yenileyip yeniden deneyin." };
  if (!shouldAutoField(effectivePresence(cur.data, now()))) return { ok: true };
  const { error } = await supabase
    .from("user_presence")
    .upsert({ user_id: g.userId, tenant_id: g.tenantId, status: "field", note: null }, { onConflict: "user_id" });
  return error ? { ok: false, error: "Durum kaydedilemedi; bağlantınızı kontrol edip yeniden deneyin." } : { ok: true };
}
