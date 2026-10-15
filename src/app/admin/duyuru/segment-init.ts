import { parseSegment } from "@/lib/platform-announcements/segment";
import type { CrmStaff, CrmTag } from "@/lib/admin/platform-crm";
import type { SegmentInit } from "./segment-builder";

/**
 * Segment oluşturucunun başlangıç durumu (SUNUCU tarafı yardımcıları; istemci bileşeni değil). Tek kaynak: kayıtlı
 * segment JSON'u (banner/NPS düzenleme) ve URL `seg_*` parametreleri (Segmentler sekmesinden "Bu segmente duyuru")
 * aynı alanlara çevrilir; yeni ölçüt eklenince yalnız burası güncellenir.
 */

type SP = Record<string, string | string[] | undefined>;

const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function segmentInitFromSegment(raw: unknown): SegmentInit | undefined {
  const seg = parseSegment(raw);
  if (!seg.ok) return undefined;
  const v = seg.value;
  return {
    plans: v.plans,
    statuses: v.statuses,
    trialDays: v.trialEndsWithinDays?.toString(),
    loginMode: v.lastLogin?.mode,
    loginDays: v.lastLogin?.days.toString(),
    city: v.cities?.join(", "),
    module: v.module?.key,
    moduleState: v.module ? (v.module.enabled ? "on" : "off") : "on",
    owners: Boolean(v.ownersOnly),
    tenant: v.tenantIds?.length === 1 ? v.tenantIds[0] : undefined,
    tags: v.tagIds,
    health: v.healthBands,
    stages: v.lifecycleStages,
    accountOwners: v.accountOwners,
    signupDays: v.signedUpWithinDays?.toString(),
  };
}

export function segmentInitFromQuery(sp: SP): Omit<SegmentInit, "tenant" | "user"> {
  return {
    plans: list(sp.seg_plan),
    statuses: list(sp.seg_status),
    trialDays: one(sp.seg_trial_days),
    loginMode: one(sp.seg_login_mode),
    loginDays: one(sp.seg_login_days),
    city: one(sp.seg_city),
    module: one(sp.seg_module),
    moduleState: one(sp.seg_module_state) || "on",
    owners: one(sp.seg_owners) === "on",
    tags: list(sp.seg_tag),
    health: list(sp.seg_health),
    stages: list(sp.seg_stage),
    accountOwners: list(sp.seg_owner),
    signupDays: one(sp.seg_signup_days),
  };
}

/** Arşivdeki "Hedef" etiketi için etiket ve personel adları. */
export function segmentNames(catalog: { tags: CrmTag[]; staff: CrmStaff[] }) {
  const tags = new Map(catalog.tags.map((t) => [t.id, t.name]));
  const staff = new Map(catalog.staff.map((s) => [s.id, s.name]));
  return { tag: (id: string) => tags.get(id), staff: (id: string) => staff.get(id) };
}
