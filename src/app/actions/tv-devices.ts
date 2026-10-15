"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { actionErrorMessage } from "@/lib/action-errors";
import { canViewTv } from "@/lib/tv/tv-logic";
import { checkRateLimit } from "@/lib/rate-limit";

export type TvDeviceRow = { id: string; name: string; createdAt: string; lastSeenAt: string | null; revokedAt: string | null };
export type TvDevicesResult = { ok?: boolean; error?: string; info?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_READY = "TV eşleştirme bu ortamda henüz etkin değil (kurulum bekliyor).";

/** Pano TV yöneticisi: rapor görme + ofis geneli rol (owner/gm/branch_manager); RPC'ler aynı kuralı DB'de uygular. */
async function tvGate(write: boolean) {
  const gate = await requirePermission("reports", "view", write ? { write: true } : undefined);
  if (!gate.ok) return gate;
  if (!canViewTv(gate.role)) return { ok: false as const, error: "TV ekranlarını ofis sahibi, genel müdür veya şube müdürü yönetir." };
  return gate;
}

/** Ofisin TV ekranları (iptal edilenler son 10 kayıtla birlikte; sır/özet hiçbir zaman dönmez). */
export async function listTvDevices(): Promise<{ available: boolean; devices: TvDeviceRow[]; error?: string }> {
  const gate = await tvGate(false);
  if (!gate.ok) return { available: true, devices: [], error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tv_devices")
    .select("id, name, created_at, last_seen_at, revoked_at")
    .eq("tenant_id", gate.tenantId)
    .order("revoked_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return { available: false, devices: [] };
  return {
    available: true,
    devices: ((data ?? []) as { id: string; name: string; created_at: string; last_seen_at: string | null; revoked_at: string | null }[]).map((d) => ({
      id: d.id,
      name: d.name,
      createdAt: d.created_at,
      lastSeenAt: d.last_seen_at,
      revokedAt: d.revoked_at,
    })),
  };
}

/**
 * TV'deki 6 haneli kodu girerek ekranı ofise bağla (OA6). Kod 10 dakika geçerlidir; kullanıcı başına 10 dakikada en çok
 * 10 deneme (kod taraması sınırı). Eşleşme ve iptal denetim kaydına RPC içinde yazılır.
 */
export async function pairTvDevice(_prev: TvDevicesResult, fd: FormData): Promise<TvDevicesResult> {
  const gate = await tvGate(true);
  if (!gate.ok) return { error: gate.error };
  const code = String(fd.get("code") ?? "").replace(/[\s-]/g, "").toUpperCase();
  const name = String(fd.get("name") ?? "").trim().slice(0, 60) || "Ofis TV";
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return { error: "TV ekranındaki 6 karakterlik kodu girin." };
  const rate = await checkRateLimit(`tv-pair-claim:${gate.userId}`, { limit: 10, windowSec: 600, failurePolicy: "deny" });
  if (!rate.allowed) return { error: "Çok fazla deneme yaptınız; birkaç dakika sonra yeniden deneyin." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("tv_device_pair", { p_code: code, p_name: name });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883" || error.code === "42P01") return { error: NOT_READY };
    if (error.code === "P0002") return { error: "Kod geçersiz ya da süresi dolmuş. TV ekranındaki güncel kodu girin." };
    return { error: actionErrorMessage(error, "TV eşleştirilemedi.") };
  }
  return { ok: true, info: `${name} eşleşti; pano birkaç saniye içinde açılır.` };
}

export async function revokeTvDevice(_prev: TvDevicesResult, fd: FormData): Promise<TvDevicesResult> {
  const gate = await tvGate(true);
  if (!gate.ok) return { error: gate.error };
  const id = String(fd.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "Ekran bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("tv_device_revoke", { p_id: id });
  if (error) return { error: actionErrorMessage(error, "Ekran kaldırılamadı.") };
  if (data !== true) return { error: "Ekran bulunamadı ya da zaten kaldırılmış." };
  return { ok: true, info: "Ekranın bağlantısı kaldırıldı." };
}
