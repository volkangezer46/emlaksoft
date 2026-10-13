import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push";
import { getSettingDef } from "@/lib/settings/registry";
import { notifyKey } from "@/lib/settings/registry/tenant";
import { coerceInput } from "@/lib/settings/view";

/**
 * Kiracıya bildirim yaz.
 *
 * NEDEN `actions/` DEĞİL DE `lib/`: Bu fonksiyon `src/app/actions/notifications.ts`
 * içindeydi. O dosya `"use server"` taşıyor, yani ORADAN EXPORT EDİLEN HER
 * FONKSİYON tarayıcıdan çağrılabilen bir uç nokta oluyor.
 *
 * Bu fonksiyonun iki özelliği birleşince sorun çıkıyordu:
 *   1. `tenantId`'yi PARAMETRE olarak alıyor — yani hedefi çağıran seçiyor
 *   2. `createAdminClient()` (service_role) kullanıyor — RLS'i tamamen atlıyor
 *
 * Yetki kontrolü de yoktu. Action kimliğini ele geçiren biri istediği kiracıya
 * istediği içerikte bildirim yazdırabilirdi.
 *
 * `lib/` altına taşınınca artık bir uç nokta DEĞİL: yalnızca sunucu tarafındaki
 * kod import edebiliyor. Çağıran 5 yerin (deals, matching, tasks, workflow,
 * platform-notifications) hepsi kendi yetki kapısını zaten geçiyor.
 *
 * service_role kullanımı burada DOĞRU: bildirim çoğu zaman işlemi yapan
 * kullanıcıdan BAŞKASINA yazılıyor (ör. eşleşme bulununca portföyün
 * danışmanına) ve o satırı kullanıcının kendi oturumu RLS yüzünden yazamaz.
 */
/**
 * Tercih anahtarları — profiles.notification_prefs jsonb'sindeki boolean
 * bayraklar. Eksik anahtar AÇIK sayılır (marketing hariç; onun UI varsayılanı
 * kapalı). Yeni tür ekleyince buraya, UI ROWS'a, action DEFAULTS'a ve ofis varsayılanı `NOTIFY_DEFAULTS`
 * (settings/registry/tenant.ts) listesine de ekle; sözleşme `notification-prefs-contract.test.ts`.
 */
export type NotifPrefKey =
  | "portal"
  | "appointment"
  | "commission"
  | "digest"
  | "marketing"
  | "priceDrop"
  | "savedSearch"
  | "share"
  | "support"
  | "dunning"
  | "rentOverdue"
  | "network"
  | "insight"
  | "assignment"
  | "authority"
  | "survey";

/** Ofisin `office.notify.default_<tür>` kaydı "kapalı" mı? Kayıt yok/okunamıyor/tür tanımsız = false (davranış değişmez). */
async function officeDefaultIsOff(admin: ReturnType<typeof createAdminClient>, tenantId: string, prefKey: string): Promise<boolean> {
  const def = getSettingDef(notifyKey(prefKey));
  if (!def) return false;
  try {
    const { data } = await admin.from("tenant_settings").select("value").eq("tenant_id", tenantId).eq("key", def.key).maybeSingle();
    if (!data || data.value === null || data.value === undefined) return false;
    const c = coerceInput(def, data.value);
    return c.ok && c.value === false;
  } catch {
    return false;
  }
}

export async function notifyTenant(input: {
  tenantId: string;
  userId?: string | null;
  title: string;
  body?: string;
  href?: string;
  kind?: "info" | "success" | "warning" | "danger" | "system";
  /**
   * Verilirse ve hedef KULLANICI bu türü kapattıysa bildirim TAMAMEN atlanır
   * (zil satırı + push) — gunluk-ozet cron'unun `wantsDigest` deseniyle aynı.
   * Tercih kaydı yoksa varsayılan AÇIK. userId'siz (tenant-geneli) bildirimde
   * sunucu tarafında kişi bazlı tercih uygulanamaz; o satırları zil tarafında
   * `filterByNotifPrefs` (notification-prefs.tsx) kullanıcı bazında süzer.
   */
  prefKey?: NotifPrefKey;
  /**
   * Verilirse ayni (tenant_id, dedupe_key) icin bildirim TEK KEZ yazilir (notifications_tenant_dedupe_key_uidx).
   * Cakisma (23505) sessizce "zaten gonderilmis" sayilir. Kolon yoksa (migration 001500 uygulanmadi) hata firlatir.
   */
  dedupeKey?: string;
}) {
  const admin = createAdminClient();

  if (input.userId) {
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("notification_prefs")
      .eq("id", input.userId)
      .eq("tenant_id", input.tenantId)
      .eq("is_active", true)
      .maybeSingle();
    if (profileError) throw new Error("Bildirim hedefi doğrulanamadı.");
    if (!profile) throw new Error("Bildirim hedefi bu ofiste aktif değil.");
    const prefs = profile?.notification_prefs as Record<string, unknown> | null | undefined;
    if (
      input.prefKey
      && prefs
      && typeof prefs === "object"
      && prefs[input.prefKey] === false
    ) return;
    // Ofis Tanımları Merkezi: kullanıcı bu türü hiç belirlememişse ofisin "kapalı" varsayılanı geçerlidir.
    // Yalnız ofisin AÇIKÇA kaydettiği "kapalı" etkilidir; kayıt yoksa davranış değişmez (eksik anahtar = açık).
    if (input.prefKey && !(prefs && typeof prefs === "object" && typeof prefs[input.prefKey] === "boolean")) {
      if (await officeDefaultIsOff(admin, input.tenantId, input.prefKey)) return;
    }
  }

  const { error: notificationError } = await admin.from("notifications").insert({
    tenant_id: input.tenantId,
    user_id: input.userId ?? null,
    title: input.title,
    body: input.body ?? null,
    href: input.href ?? null,
    kind: input.kind ?? "info",
    ...(input.dedupeKey ? { dedupe_key: input.dedupeKey } : {}),
  });
  // Ayni anahtar daha once yazilmis: bildirim zaten var (tek kez); push da tekrar gonderilmez.
  if (notificationError && input.dedupeKey && notificationError.code === "23505") return;
  if (notificationError) throw new Error("Bildirim kalıcılaştırılamadı.");

  if (input.userId) {
    // Best-effort: VAPID yoksa sessizce atlar, bildirim satırı zaten yazıldı.
    void sendPushToUser(input.tenantId, input.userId, {
      title: input.title,
      body: input.body,
      href: input.href,
    });
  }
}

export type BulkNotifyItem = {
  /** Çağıranın satır anahtarı (ör. duyuru teslim id'si); sonuç bu anahtarla döner. */
  key: string;
  tenantId: string;
  userId: string;
  title: string;
  body?: string;
  href?: string;
  kind?: "info" | "success" | "warning" | "danger" | "system";
  /** notifyTenant ile aynı anlam: kullanıcı bu türü AÇIKÇA kapattıysa satır yazılmaz (skipped). */
  prefKey?: NotifPrefKey;
  meta?: Record<string, unknown>;
};

export type BulkNotifyResult = { ok: true; notificationId: string } | { ok: false; skipped?: boolean; error: string };

/**
 * Toplu, KULLANICIYA ÖZEL bildirim (platform duyuru kuyruğu): notifyTenant'ın userId + prefKey kurallarını
 * satır başına uygular ama TEK profil okuması ve parça başına TEK insert ile (200 ofis x N kullanıcı birkaç turda).
 * Push göndermez (duyurunun ayrı push kanalı vardır). Ofisin "kapalı" varsayılanı burada uygulanmaz: ticari ileti
 * (marketing) çağıranda AÇIK kullanıcı izniyle süzülür, diğer duyurular ofis varsayılanına bağlı değildir.
 * İstemci OLUŞTURMAZ: çağıranın service_role istemcisini alır.
 */
export async function notifyUsersBulk(
  admin: ReturnType<typeof createAdminClient>,
  items: readonly BulkNotifyItem[],
): Promise<Map<string, BulkNotifyResult>> {
  const out = new Map<string, BulkNotifyResult>();
  if (items.length === 0) return out;
  const userIds = [...new Set(items.map((i) => i.userId))];
  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, tenant_id, notification_prefs")
    .in("id", userIds)
    .eq("is_active", true);
  if (error) {
    for (const i of items) out.set(i.key, { ok: false, error: "Bildirim hedefi doğrulanamadı." });
    return out;
  }
  type P = { id: string; tenant_id: string; notification_prefs: Record<string, unknown> | null };
  const byId = new Map(((profiles ?? []) as P[]).map((p) => [p.id, p]));
  const rows: { id: string; key: string; row: Record<string, unknown> }[] = [];
  for (const i of items) {
    const p = byId.get(i.userId);
    if (!p || p.tenant_id !== i.tenantId) {
      out.set(i.key, { ok: false, skipped: true, error: "Kullanıcı bu ofiste aktif değil" });
      continue;
    }
    const prefs = p.notification_prefs;
    if (i.prefKey && prefs && typeof prefs === "object" && prefs[i.prefKey] === false) {
      out.set(i.key, { ok: false, skipped: true, error: "Kullanıcı bu bildirim türünü kapattı" });
      continue;
    }
    const id = crypto.randomUUID();
    rows.push({
      id,
      key: i.key,
      row: {
        id,
        tenant_id: i.tenantId,
        user_id: i.userId,
        title: i.title,
        body: i.body ?? null,
        href: i.href ?? null,
        kind: i.kind ?? "info",
        ...(i.meta ? { meta: i.meta } : {}),
      },
    });
  }
  for (let s = 0; s < rows.length; s += 500) {
    const chunk = rows.slice(s, s + 500);
    const { error: insErr } = await admin.from("notifications").insert(chunk.map((c) => c.row));
    for (const c of chunk) out.set(c.key, insErr ? { ok: false, error: "Bildirim kalıcılaştırılamadı." } : { ok: true, notificationId: c.id });
  }
  return out;
}
