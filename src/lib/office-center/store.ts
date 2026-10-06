/**
 * Ofis Merkezi veri okuyucu ve yazarı (saf mantık yok, sunucu işlemleri)
 */

import { SupabaseClient } from "@supabase/supabase-js";
import type { OfficeAdvisor, PoolAssignment, OfficeSettings } from "./types";

/**
 * Ofis danışmanları listesi
 */
export async function loadOfficeAdvisors(
  db: SupabaseClient,
  tenantId: string
): Promise<OfficeAdvisor[]> {
  const { data, error } = await db
    .from("profiles")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("full_name");

  if (error) throw new Error(`Danışmanlar yükleme hatası: ${error.message}`);
  return data || [];
}

/**
 * Havuz atamalarının geçmişi
 */
export async function loadPoolAssignmentHistory(
  db: SupabaseClient,
  tenantId: string,
  limit = 100
): Promise<PoolAssignment[]> {
  // TODO: assignment_history tablosu migration'ında tanımlanacak
  // Şimdi boş dönsün, RLS denetimi yapılsın

  return [];
}

/**
 * SLA takibi - geçmiş süresi içindeki atamalar
 */
export async function loadUnassignedPoolProperties(
  db: SupabaseClient,
  tenantId: string
): Promise<{ id: string; address: string; addedAt: string }[]> {
  // TODO: listing_pool_entries tablosundan
  // assigned_to IS NULL ve created_at >= now() - interval '1 day'
  // RLS kontrolü

  return [];
}

/**
 * Ofis ayarlarını oku
 */
export async function loadOfficeSettings(
  db: SupabaseClient,
  tenantId: string
): Promise<Record<string, unknown>> {
  const { data, error } = await db
    .from("platform_settings")
    .select("key, value")
    .eq("tenant_id", tenantId);

  if (error) throw new Error(`Ayarlar yükleme hatası: ${error.message}`);

  const settings: Record<string, unknown> = {};
  for (const row of data || []) {
    settings[row.key] = row.value;
  }

  return settings;
}

/**
 * Danışman performans metrikleri (defter bazlı)
 */
export async function loadAdvisorMetrics(
  db: SupabaseClient,
  tenantId: string,
  advisorId: string
): Promise<{
  sales: number;
  rentals: number;
  commission: number;
  activityScore: number;
}> {
  // TODO: commissions, deals, rentals tablolarından raporla
  // RLS denetimi

  return {
    sales: 0,
    rentals: 0,
    commission: 0,
    activityScore: 0,
  };
}

/**
 * Ofis istatistikleri
 */
export async function loadOfficeStatistics(
  db: SupabaseClient,
  tenantId: string
): Promise<{
  totalProperties: number;
  totalDeals: number;
  totalRentals: number;
}> {
  // TODO: properties, deals, rentals tablolarından say ve oran hesapla
  // RLS denetimi

  return {
    totalProperties: 0,
    totalDeals: 0,
    totalRentals: 0,
  };
}

/**
 * Audit log - ayar değişim geçmişi
 */
export async function loadSettingHistory(
  db: SupabaseClient,
  tenantId: string,
  settingKey: string,
  limit = 20
): Promise<
  Array<{
    value: unknown;
    changedAt: string;
    changedBy: string;
    version: number;
  }>
> {
  // TODO: audit_log tablosundan bu ayar için değişimleri oku
  // RLS: ofis kaydı gör

  return [];
}
