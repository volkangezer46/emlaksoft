"use server";

import { revalidatePath } from "next/cache";
import { actionErrorMessage } from "@/lib/action-errors";
import {
  compactOnboardingContent,
  isEmptyOnboardingContent,
  resolveTours,
  validateOnboardingContentFull,
} from "@/lib/onboarding-content";
import { loadOnboardingContent } from "@/lib/onboarding-content-read";
import { requirePlatformModule } from "@/lib/platform";
import { guardPlatformAction } from "@/lib/platform-guards";
import type { TourDef } from "@/lib/product-tour-data";
import { requireActiveTenant } from "@/lib/tenant-guard";
import { applyPlatformWrites } from "@/lib/settings/write";
import { ONBOARDING_CONTENT_KEY } from "@/lib/settings/registry/onboarding";
import { createClient } from "@/lib/supabase/server";

/**
 * ÜRÜN TURU ve KURULUM içeriği eylemleri (SN5).
 *  - `loadProductTours`: ofis kullanıcısının turları (adminden düzenlenmiş metin/sıra + rol/paket hedefi). Tur parçası yalnız
 *    tur açılacağı zaman yüklenir ve bu eylemi o an bir kez çağırır; hata = koddaki turlar (istemci yedeği).
 *  - `saveOnboardingContent` / `resetOnboardingContent`: Ofisler > Kurulum > İçerik düzenleyicisi. Kapı: `tenants` modülü +
 *    süper admin ya da operasyon + hız sınırı; yazım ayar defterinin tek yolundan (değer + geçmiş + denetim izi).
 */

export type OnboardingContentResult = { ok?: boolean; error?: string; message?: string };

const RATE = { key: "onboarding-content", limit: 30, windowSec: 600 } as const;
const EDITOR_ROLES = ["super_admin", "ops"] as const;

/** Ofis kullanıcısının çalıştırılacak turları; oturum/ofis yoksa null (istemci koddaki turlarla devam eder). */
export async function loadProductTours(): Promise<TourDef[] | null> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return null;
  try {
    const supabase = await createClient();
    const [content, { data }] = await Promise.all([
      loadOnboardingContent(),
      supabase.from("tenants").select("plan").eq("id", gate.tenantId).maybeSingle(),
    ]);
    const plan = (data as { plan?: string | null } | null)?.plan ?? null;
    return resolveTours(content, { role: gate.role, plan });
  } catch {
    return null;
  }
}

async function editorGate() {
  await requirePlatformModule("tenants");
  const gate = await guardPlatformAction({ module: "tenants", action: "write", roles: EDITOR_ROLES, rate: RATE });
  if ("error" in gate) {
    return { error: gate.error.includes("süper admin") ? "Tur ve kurulum içeriğini yalnız süper admin ve operasyon ekibi düzenleyebilir." : gate.error } as const;
  }
  return gate;
}

function revalidateOnboarding() {
  revalidatePath("/admin/tenants/kurulum");
  revalidatePath("/app/baslangic");
  revalidatePath("/app");
}

export async function saveOnboardingContent(input: { content: unknown; reason?: string }): Promise<OnboardingContentResult> {
  const gate = await editorGate();
  if ("error" in gate) return { error: gate.error };
  const valid = validateOnboardingContentFull(input?.content);
  if (!valid.ok) return { error: valid.error };
  const compact = compactOnboardingContent(valid.value);
  const value = isEmptyOnboardingContent(compact) ? null : JSON.stringify(compact);
  try {
    const res = await applyPlatformWrites(
      gate.staff,
      [{ key: ONBOARDING_CONTENT_KEY, value }],
      {
        reason: (input?.reason ?? "").trim().slice(0, 300) || "Tur ve kurulum içeriği düzenlendi",
        fromBridge: true,
        summary: value === null ? "varsayılana dönüldü" : "tur/kurulum içeriği güncellendi",
      },
    );
    if (!res.ok) return { error: res.error };
    revalidateOnboarding();
    return { ok: true, message: value === null ? "İçerik koddaki varsayılanla aynı; varsayılana dönüldü." : "Kaydedildi. Ofislerde en geç 30 saniye içinde görünür." };
  } catch (err) {
    return { error: actionErrorMessage(err, "Tur ve kurulum içeriği kaydedilemedi") };
  }
}

export async function resetOnboardingContent(input: { reason?: string }): Promise<OnboardingContentResult> {
  const gate = await editorGate();
  if ("error" in gate) return { error: gate.error };
  try {
    const res = await applyPlatformWrites(
      gate.staff,
      [{ key: ONBOARDING_CONTENT_KEY, value: null }],
      { reason: (input?.reason ?? "").trim().slice(0, 300) || "Varsayılan tur ve kurulum içeriğine dönüldü", fromBridge: true },
    );
    if (!res.ok) return { error: res.error };
    revalidateOnboarding();
    return { ok: true, message: "Koddaki varsayılan turlar ve kurulum adımları geri geldi." };
  } catch (err) {
    return { error: actionErrorMessage(err, "Varsayılana dönülemedi") };
  }
}
