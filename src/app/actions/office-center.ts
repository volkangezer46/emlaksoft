"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";

/**
 * Ofis Merkezi server actions
 *
 * Danışman yönetimi, havuzdan atama, ofis ayarları, tanımlamalar ve istatistik işlemleri
 */

// ===== DANIŞMAN YÖNETİMİ =====

export async function addAdvisor(data: {
  fullName: string;
  phone: string;
  email: string;
  role: "advisor" | "team_lead" | "branch_manager";
  branchId?: string;
}) {
  await requirePermission("office_center", "create");

  const db = createAdminClient();

  // TODO: Danışman ekleme mantığı
  // - profiles tablosuna ekleme
  // - office_id, tenant_id, role, is_active=true
  // - RLS denetimi
  // - Audit log yazması

  return { success: true };
}

export async function updateAdvisor(advisorId: string, data: {
  fullName?: string;
  role?: string;
  isActive?: boolean;
}) {
  await requirePermission("office_center", "edit");

  const db = createAdminClient();

  // TODO: Danışman güncelleme
  // - profiles update
  // - Rol değişiş geçmiş yazması
  // - Audit log

  return { success: true };
}

export async function deleteAdvisor(advisorId: string) {
  await requirePermission("office_center", "delete");

  const db = createAdminClient();

  // TODO: Danışman silme (soft-delete)
  // - is_active = false
  // - Audit log

  return { success: true };
}

// ===== HAVUZDAN ATAMA =====

export async function assignFromPool(data: {
  propertyIds: string[];
  advisorId: string;
  assignmentRuleId?: string;
}) {
  await requirePermission("office_center", "create");

  const db = createAdminClient();

  // TODO: Havuzdan atama
  // - listing_pool_entries tablosundan properties.assigned_to güncelle
  // - assigned_at timestamp yazması
  // - Atama geçmişi loglaması
  // - SLA zamanlayıcısı

  return { success: true };
}

export async function cancelAssignment(assignmentId: string, reason?: string) {
  await requirePermission("office_center", "edit");

  const db = createAdminClient();

  // TODO: Atama iptali
  // - properties.assigned_to NULL yap
  // - Geçmiş kayıt kırmızı işaretle
  // - Bildirim gönder

  return { success: true };
}

// ===== OFIS AYARLARI =====

export async function saveOfficeSettings(settings: Record<string, unknown>) {
  await requirePermission("office_center", "edit");

  const db = createAdminClient();

  // TODO: Ofis ayarlarını kaydet
  // - platform_settings tablosundan tenant'ın ayarlarını güncelle
  // - Versiyon geçmişi (audit_log ya da ayrı tablo)
  // - Değiştirenin kişi ve tarihi kaydet
  // - 18 ayarın tümü için doğrulama

  return { success: true };
}

export async function getOfficeSettings() {
  await requirePermission("office_center", "view");

  const db = createClient();

  // TODO: Ofis ayarlarını oku
  // - platform_settings'ten tenant ayarlarını filtrele
  // - RLS denetimi
  // - Geçmiş varsa sürüm numarası ve değişim zamanı

  return { settings: {} };
}

// ===== TANIMLAMALAR =====

export async function saveSLADefinition(data: {
  assignmentSLA: number; // saat
  escalationSLA: number; // saat
  closureSLA: number; // gün
}) {
  await requirePermission("office_center", "edit");

  const db = createAdminClient();

  // TODO: SLA tanımlamaları kaydet
  // - platform_settings ya da ayrı tablo
  // - Geçmiş kaydı

  return { success: true };
}

export async function saveCommissionDefinition(data: {
  advisorCommission: number; // %
  officeCommission: number; // %
  specialtyBonus?: Record<string, number>;
}) {
  await requirePermission("office_center", "edit");

  const db = createAdminClient();

  // TODO: Komisyon yüzdeleri kaydet
  // - src/lib/settings/registry/tenant.ts referans

  return { success: true };
}

export async function saveAlertThresholds(data: {
  unassignedPropertyCount: number;
  slaBreach: number;
  noActivityDays: number;
}) {
  await requirePermission("office_center", "edit");

  const db = createAdminClient();

  // TODO: Uyarı eşikleri kaydet

  return { success: true };
}

// ===== İSTATİSTİKLER =====

export async function getOfficeStats() {
  await requirePermission("office_center", "view");

  const db = createClient();

  // TODO: Ofis istatistikleri oku
  // - Portföy sayısı (properties)
  // - Satış oranı (deals/total)
  // - Kiralama oranı (rentals/total)
  // - Harita (region_stats)

  return {
    totalProperties: 0,
    totalDeals: 0,
    totalRentals: 0,
    salesRatio: 0,
    rentalRatio: 0,
  };
}

export async function getAdvisorPerformanceLeague() {
  await requirePermission("office_center", "view");

  const db = createClient();

  // TODO: Danışman performans ligi
  // - Sıralama (satış sayısı, komisyon, etkinlik)
  // - Lig tablosu (ekip metrikleri)

  return { league: [] };
}

export async function getTeamHealth() {
  await requirePermission("office_center", "view");

  const db = createClient();

  // TODO: Ekip sağlığı metrikleri
  // - Ortalama işlem süresi
  // - Uyarı sayısı
  // - Sistem durumu

  return {
    averageProcessTime: 0,
    alertCount: 0,
    systemHealth: "healthy",
  };
}
