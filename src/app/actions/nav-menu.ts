"use server";

import { revalidatePath } from "next/cache";
import { actionErrorMessage } from "@/lib/action-errors";
import { guardPlatformAction } from "@/lib/platform-guards";
import { applyPlatformWrites } from "@/lib/settings/write";
import { NAV_MENU_OVERRIDES_KEY } from "@/lib/settings/registry/nav-menu";
import { parseMenuOverrides, serializeMenuOverrides } from "@/lib/nav-overrides";

/**
 * MENÜ YÖNETİMİ eylemleri (Yönetim > Menü yönetimi). Kapı: `sistem` modülü + yalnız süper admin + hız sınırı. Girdi
 * `parseMenuOverrides` ile süzülür (bilinmeyen anahtar, zorunlu satır gizleme, uzun ad atılır); varsayılanla aynı fark
 * yazılmaz. Yazım ayar defterinin tek yolundan (değer + geçmiş + platform denetim izi "settings.write").
 */

export type NavMenuResult = { ok?: boolean; error?: string; message?: string };

const RATE = { key: "nav-menu", limit: 30, windowSec: 600 } as const;

async function gate() {
  const g = await guardPlatformAction({ module: "sistem", action: "write", roles: ["super_admin"], rate: RATE });
  if ("error" in g) return { error: g.error.includes("süper admin") ? "Menüleri yalnız süper admin düzenleyebilir." : g.error } as const;
  return g;
}

function revalidateMenus() {
  revalidatePath("/admin/ayarlar/menu");
  // Kabuklar (yan menü) her sayfada: layout düzeyinde tazelenir.
  revalidatePath("/app", "layout");
  revalidatePath("/admin", "layout");
}

export async function saveNavMenuOverrides(input: { overrides: unknown; reason?: string }): Promise<NavMenuResult> {
  const g = await gate();
  if ("error" in g) return { error: g.error };
  const value = serializeMenuOverrides(parseMenuOverrides(input?.overrides ?? null));
  try {
    const res = await applyPlatformWrites(g.staff, [{ key: NAV_MENU_OVERRIDES_KEY, value }], {
      reason: (input?.reason ?? "").trim().slice(0, 300) || "Panel menüleri düzenlendi",
      fromBridge: true,
      summary: value === null ? "varsayılana dönüldü" : "menü düzeni güncellendi",
    });
    if (!res.ok) return { error: res.error };
    revalidateMenus();
    return { ok: true, message: value === null ? "Fark kalmadı; varsayılan menüler kullanılıyor." : "Kaydedildi. Menüler en geç 30 saniye içinde güncellenir." };
  } catch (err) {
    return { error: actionErrorMessage(err, "Menü düzeni kaydedilemedi") };
  }
}

export async function resetNavMenuOverrides(input: { reason?: string }): Promise<NavMenuResult> {
  const g = await gate();
  if ("error" in g) return { error: g.error };
  try {
    const res = await applyPlatformWrites(g.staff, [{ key: NAV_MENU_OVERRIDES_KEY, value: null }], {
      reason: (input?.reason ?? "").trim().slice(0, 300) || "Varsayılan menülere dönüldü",
      fromBridge: true,
    });
    if (!res.ok) return { error: res.error };
    revalidateMenus();
    return { ok: true, message: "Koddaki varsayılan menüler geri geldi." };
  } catch (err) {
    return { error: actionErrorMessage(err, "Varsayılana dönülemedi") };
  }
}
