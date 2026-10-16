import type { createClient } from "@/lib/supabase/server";
import { DEFAULT_ORIENTATION, isMissingRecruitSchema, type OrientationTemplateItem } from "./logic";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type OrientationTemplate = {
  /** Tablo kurulu mu (migration uygulanmadıysa false: kartlar "kurulum bekliyor" der). */
  available: boolean;
  /** Ofis kendi şablonunu kaydetti mi (false: varsayılan liste). */
  custom: boolean;
  items: OrientationTemplateItem[];
};

/** Ofisin oryantasyon şablonu; kayıt yoksa `DEFAULT_ORIENTATION`. RLS: team:edit. */
export async function loadOrientationTemplate(supabase: Supabase, tenantId: string): Promise<OrientationTemplate> {
  const { data, error } = await supabase
    .from("onboarding_template_items")
    .select("title, description, offset_days, sort")
    .eq("tenant_id", tenantId)
    .order("sort", { ascending: true })
    .limit(50);
  if (error) {
    return { available: !isMissingRecruitSchema(error), custom: false, items: [...DEFAULT_ORIENTATION] };
  }
  const rows = (data ?? []) as { title: string; description: string | null; offset_days: number }[];
  if (rows.length === 0) return { available: true, custom: false, items: [...DEFAULT_ORIENTATION] };
  return {
    available: true,
    custom: true,
    items: rows.map((r) => ({ title: r.title, description: r.description, offsetDays: Number(r.offset_days) || 0 })),
  };
}

export type OrientationItemRow = {
  id: string;
  title: string;
  description: string | null;
  due_on: string | null;
  sort: number;
  task_id: string | null;
  done_at: string | null;
  task: { status: string | null } | { status: string | null }[] | null;
};

/** Üyenin oryantasyon adımları (bağlı görev durumuyla). `available=false`: tablo yok. */
export async function loadOrientationItems(
  supabase: Supabase,
  tenantId: string,
  profileId: string,
): Promise<{ available: boolean; items: (OrientationItemRow & { task_status: string | null })[] }> {
  const { data, error } = await supabase
    .from("onboarding_items")
    .select("id, title, description, due_on, sort, task_id, done_at, task:tasks!onboarding_items_task_id_fkey(status)")
    .eq("tenant_id", tenantId)
    .eq("profile_id", profileId)
    .order("sort", { ascending: true })
    .limit(60);
  // Tablo yoksa (ya da okunamazsa) kart gizlenir: yanlış "oryantasyon yok" iddiası yerine sessizlik.
  if (error) return { available: false, items: [] };
  return {
    available: true,
    items: ((data ?? []) as OrientationItemRow[]).map((r) => {
      const t = Array.isArray(r.task) ? r.task[0] : r.task;
      return { ...r, task_status: t?.status ?? null };
    }),
  };
}
