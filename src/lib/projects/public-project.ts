import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { isPublicFeatureClosed } from "@/lib/modules/public";
import { districtWithProvinceResult } from "@/lib/geo/reader";
import { loadProjectMedia, type ProjectMediaItem } from "./project-media";
import { PROJECT_TOKEN_RE } from "./project-share";

/**
 * PF-04 — /proje/[token] herkese açık proje sayfasının TEK okuyucusu (sayfa + metadata aynı istekte paylaşır).
 * Token yalnız `share_enabled=true` projede çözülür; her alt okuma projenin kiracısına bağlanır (service_role).
 * Dönen veri: proje künyesi, müsait daireler (fiyat yalnız "fiyat göster" açıksa), galeri, iletişim. Müşteri bilgisi,
 * rezerve/satılmış dairenin alıcısı ya da iç not ASLA dönmez.
 */
export type PublicProjectUnit = {
  id: string;
  block: string | null;
  floor: number | null;
  unit_no: string;
  rooms: string | null;
  gross_m2: number | null;
  price: number | null;
};

export type PublicProject = {
  state: "ok" | "closed";
  office: {
    name: string;
    logoUrl: string | null;
    brandColor: string | null;
    phone: string | null;
    leadToken: string | null;
    leadEnabled: boolean | null;
  };
  project: {
    name: string;
    developer: string | null;
    location: string | null;
    area: string | null;
    deliveryDate: string | null;
    description: string | null;
    status: string;
  };
  showPrices: boolean;
  units: PublicProjectUnit[];
  totals: { all: number; available: number; sold: number };
  media: ProjectMediaItem[];
  advisor: { name: string; title: string | null; phone: string | null } | null;
};

export const loadPublicProject = cache(async (token: string): Promise<PublicProject | null> => {
  if (!PROJECT_TOKEN_RE.test(token)) return null;
  const admin = createAdminClient();
  const { data: project, error } = await admin
    .from("projects")
    .select("id, tenant_id, name, developer_name, location, district_id, delivery_date, description, status, share_show_prices, created_by")
    .eq("share_token", token)
    .eq("share_enabled", true)
    .maybeSingle();
  if (error || !project) return null;
  const tenantId = String(project.tenant_id);
  const projectId = String(project.id);

  const [{ data: tenant }, { data: unitRows }, media, { data: creator }, district] = await Promise.all([
    admin
      .from("tenants")
      .select("name, status, logo_url, brand_color, phone, lead_capture_token, lead_capture_enabled")
      .eq("id", tenantId)
      .maybeSingle(),
    admin
      .from("project_units")
      .select("id, block, floor, unit_no, rooms, gross_m2, list_price, status")
      .eq("project_id", projectId)
      .eq("tenant_id", tenantId)
      .order("block", { ascending: true })
      .order("floor", { ascending: true })
      .order("unit_no", { ascending: true })
      .limit(1000),
    loadProjectMedia(admin, { tenantId, projectId }),
    project.created_by
      ? admin
          .from("profiles")
          .select("full_name, title, phone, is_public")
          .eq("id", project.created_by as string)
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    project.district_id ? districtWithProvinceResult(project.district_id as string) : Promise.resolve({ data: null }),
  ]);
  if (!tenant || !isPublicTenantActive(tenant.status as string | null)) return null;

  const office = {
    name: (tenant.name as string | null) ?? "Emlak ofisi",
    logoUrl: (tenant.logo_url as string | null) ?? null,
    brandColor: (tenant.brand_color as string | null) ?? null,
    phone: (tenant.phone as string | null) ?? null,
    leadToken: (tenant.lead_capture_token as string | null) ?? null,
    leadEnabled: (tenant.lead_capture_enabled as boolean | null) ?? null,
  };
  const showPrices = project.share_show_prices !== false;
  const all = (unitRows ?? []) as Array<{
    id: string;
    block: string | null;
    floor: number | null;
    unit_no: string;
    rooms: string | null;
    gross_m2: number | string | null;
    list_price: number | string | null;
    status: string;
  }>;
  const available = all.filter((u) => u.status === "available");
  const d = district.data;
  const c = creator as { full_name?: string | null; title?: string | null; phone?: string | null; is_public?: boolean } | null;

  const base: Omit<PublicProject, "state"> = {
    office,
    project: {
      name: String(project.name),
      developer: (project.developer_name as string | null) ?? null,
      location: (project.location as string | null) ?? null,
      area: d ? [d.name, d.province?.name].filter(Boolean).join(", ") : null,
      deliveryDate: (project.delivery_date as string | null) ?? null,
      description: (project.description as string | null) ?? null,
      status: String(project.status),
    },
    showPrices,
    units: available.map((u) => ({
      id: u.id,
      block: u.block,
      floor: u.floor,
      unit_no: u.unit_no,
      rooms: u.rooms,
      gross_m2: u.gross_m2 != null ? Number(u.gross_m2) : null,
      price: showPrices && u.list_price != null ? Number(u.list_price) : null,
    })),
    totals: { all: all.length, available: available.length, sold: all.filter((u) => u.status === "sold").length },
    media: media.items.filter((m) => m.url),
    // Danışman yalnız herkese açık profiliyle (vitrin kuralı); değilse ofis iletişimi kullanılır.
    advisor: c?.full_name && c.is_public ? { name: c.full_name, title: c.title ?? null, phone: c.phone ?? null } : null,
  };
  if (await isPublicFeatureClosed(admin, tenantId, "projects")) return { state: "closed", ...base };
  return { state: "ok", ...base };
});
