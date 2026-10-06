/**
 * Dashboard veri yükleme: paralel batch sorguları
 * Tüm ana ekran bileşenleri bu modülden veri alabilir.
 * React cache() ile istek başına bir kez çalıştırılır.
 */

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { HomeCtx } from "./data";

export interface DashboardSnapshot {
  briefingReady: boolean;
  metricsReady: boolean;
  tasksReady: boolean;
  programReady: boolean;
}

/**
 * Tüm dashboard verisi paralel yükle
 * Önemli: bileşenler kendi RPC'lerini çağırmaya devam eder;
 * bu modül yalnız veri hazırlığı yapısı sağlar ve preload ipucu verir.
 */
export const loadDashboardSnapshot = cache(
  async (tenantId: string, userId: string): Promise<DashboardSnapshot> => {
    try {
      const supabase = await createClient();

      // Paralel batch: tüm kritik dashboard verisi
      // Bu RPC'ler yoksa fallback kontrollü olmalı (fonksiyon hata atmasın)
      const results = await Promise.allSettled([
        // İçgörü snapshot (brifing, kuyruk)
        supabase
          .rpc("get_insights_snapshot", { p_tenant_id: tenantId })
          .then((r: { error: unknown; data: unknown }) => {
            if (r.error) throw r.error;
            return r.data;
          }),
        // Metrik snapshot (KPI'lar)
        supabase
          .rpc("get_metrics_snapshot", { p_tenant_id: tenantId, p_user_id: userId })
          .then((r: { error: unknown; data: unknown }) => {
            if (r.error) throw r.error;
            return r.data;
          }),
        // Görev snapshot (bugün + vadesi yakın)
        supabase
          .rpc("get_tasks_snapshot", { p_tenant_id: tenantId, p_user_id: userId })
          .then((r: { error: unknown; data: unknown }) => {
            if (r.error) throw r.error;
            return r.data;
          }),
        // Program ayarları
        supabase
          .from("program_settings")
          .select("*")
          .eq("tenant_id", tenantId)
          .single()
          .then((r: { error: unknown; data: unknown }) => {
            if (r.error) throw r.error;
            return r.data;
          }),
      ]);

      return {
        briefingReady: results[0].status === "fulfilled",
        metricsReady: results[1].status === "fulfilled",
        tasksReady: results[2].status === "fulfilled",
        programReady: results[3].status === "fulfilled",
      };
    } catch {
      // RPC'ler yoksa (migration henüz uygulanmadı) boş dön
      return {
        briefingReady: false,
        metricsReady: false,
        tasksReady: false,
        programReady: false,
      };
    }
  },
);

/**
 * Viewport dışı bileşenleri lazy yüklemek için yardımcı hook
 * (İstemci tarafından çağrılır; sunucu bileşeni değildir)
 */
export interface LazyLoadingOptions {
  threshold?: number;
  rootMargin?: string;
}

/**
 * Sadeleştirilmiş veri: dashboard grid'i yapılandır
 * Her bileşen kendi Suspense'ini yönetir; bu yalnız
 * paralel preload başlatmak içindir.
 */
export async function preloadDashboardData(ctx: HomeCtx) {
  // Ön yükleme başlat (await etme; fire-and-forget)
  if (ctx.tenantId && ctx.userId) {
    void loadDashboardSnapshot(ctx.tenantId, ctx.userId);
  }
}
