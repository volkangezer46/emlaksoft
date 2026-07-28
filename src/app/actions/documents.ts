"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { isDocSource, SOURCE_GATE } from "@/lib/documents";

/**
 * Belge Merkezi (/app/belgeler) yazma işlemleri.
 *
 * Kural: birleşik liste tek ekranda dursa da YETKİ BİRLEŞMEZ. Her satır
 * geldiği kaynağın kendi modül izniyle kapılıdır — müşteri dosyası silmek
 * için `customers:edit`, portföy medyası için `properties:edit` gerekir.
 * Böylece belge merkezi, mevcut modül kapılarını dolaşan bir arka kapı olmaz.
 *
 * Tenant doğrulaması SATIR SATIR yapılır: RLS'e ek olarak her sorguda açık
 * `.eq("tenant_id", gate.tenantId)` vardır (toplu işlemde bir yabancı id
 * listeye karışırsa sessizce eleniyor, işlem tümden patlamıyor).
 */

/* Kaynak → (modül, aksiyon) eşlemesi `src/lib/documents.ts`'te (SOURCE_GATE):
   "use server" dosyaları yalnız async fonksiyon export edebilir, sabit tablo
   burada duramaz — sayfa da aynı eşlemeyi okuyup butonları gizliyor. */

export type DocumentResult = { ok?: boolean; error?: string; deleted?: number };

// ---------------------------------------------------------------------------
// Tek belge
// ---------------------------------------------------------------------------

/**
 * Kaynağa göre doğru tabloya giden silme.
 *
 * Kaynak başına davranış (bilinçli olarak farklı):
 *  - musteri  → satır + storage nesnesi silinir (dosyanın kendisi bizde).
 *  - portfoy  → satır + storage nesnesi silinir (harici URL'li video/turda
 *               storage_path null olur, yalnız satır gider).
 *  - evrak    → yalnız `file_url` temizlenir; kontrol listesi MADDESİ kalır.
 *               Madde silinseydi "eksik evrak" uyarısı da kaybolurdu; belge
 *               merkezinden dosyayı kaldırmak, evrağı gereksiz kılmaz.
 *  - sozlesme → satır SİLİNMEZ, iptal edilir (status=cancelled). İmzalı
 *               sözleşme hukuki kayıttır; imzalıysa işlem reddedilir.
 */
export async function deleteDocument(kaynak: string, id: string): Promise<DocumentResult> {
  if (!isDocSource(kaynak)) return { error: "Bilinmeyen belge kaynağı." };
  const cleanId = String(id ?? "").trim();
  if (!cleanId) return { error: "Belge bulunamadı." };

  const { mod, action } = SOURCE_GATE[kaynak];
  const gate = await requirePermission(mod, action);
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();

  if (kaynak === "musteri") {
    const { data: file } = await supabase
      .from("customer_files")
      .select("id, customer_id, storage_path, file_name")
      .eq("id", cleanId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();
    if (!file) return { error: "Dosya bulunamadı." };

    if (file.storage_path) {
      const admin = createAdminClient();
      await admin.storage.from("customer-files").remove([file.storage_path]);
    }
    const { error } = await supabase
      .from("customer_files")
      .delete()
      .eq("id", cleanId)
      .eq("tenant_id", gate.tenantId);
    if (error) {
      console.error("deleteDocument customer_files", error);
      return { error: "Dosya silinemedi." };
    }

    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "customer_file.delete",
      entityType: "customer",
      entityId: file.customer_id,
      oldValue: { file_name: file.file_name, kaynak: "belge_merkezi" },
    });
    revalidatePath("/app/belgeler");
    revalidatePath(`/app/musteriler/${file.customer_id}`);
    return { ok: true, deleted: 1 };
  }

  if (kaynak === "portfoy") {
    const { data: media } = await supabase
      .from("property_media")
      .select("id, property_id, storage_path, file_name")
      .eq("id", cleanId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();
    if (!media) return { error: "Medya bulunamadı." };

    if (media.storage_path) {
      const admin = createAdminClient();
      await admin.storage.from("property-media").remove([media.storage_path]);
    }
    const { error } = await supabase
      .from("property_media")
      .delete()
      .eq("id", cleanId)
      .eq("tenant_id", gate.tenantId);
    if (error) {
      console.error("deleteDocument property_media", error);
      return { error: "Medya silinemedi." };
    }

    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "property_media.delete",
      entityType: "property",
      entityId: media.property_id,
      oldValue: { file_name: media.file_name, kaynak: "belge_merkezi" },
    });
    revalidatePath("/app/belgeler");
    revalidatePath(`/app/portfoyler/${media.property_id}`);
    return { ok: true, deleted: 1 };
  }

  if (kaynak === "evrak") {
    const { data: item } = await supabase
      .from("deal_checklist_items")
      .select("id, deal_id, label, file_url")
      .eq("id", cleanId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();
    if (!item) return { error: "Evrak maddesi bulunamadı." };
    if (!item.file_url) return { error: "Bu maddede kaldırılacak dosya yok." };

    const { error } = await supabase
      .from("deal_checklist_items")
      .update({ file_url: null })
      .eq("id", cleanId)
      .eq("tenant_id", gate.tenantId);
    if (error) {
      console.error("deleteDocument deal_checklist_items", error);
      return { error: "Evrak bağlantısı kaldırılamadı." };
    }

    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "deal_checklist.file_clear",
      entityType: "deal",
      entityId: item.deal_id,
      oldValue: { label: item.label, file_url: item.file_url },
    });
    revalidatePath("/app/belgeler");
    revalidatePath(`/app/anlasmalar/${item.deal_id}`);
    return { ok: true, deleted: 1 };
  }

  // kaynak === "sozlesme"
  const { data: contract } = await supabase
    .from("contracts")
    .select("id, title, status")
    .eq("id", cleanId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!contract) return { error: "Sözleşme bulunamadı." };
  if (contract.status === "signed") {
    return { error: "İmzalanmış sözleşme kaldırılamaz — hukuki kayıttır." };
  }
  if (contract.status === "cancelled") return { error: "Sözleşme zaten iptal edilmiş." };

  const { error } = await supabase
    .from("contracts")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", cleanId)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("deleteDocument contracts", error);
    return { error: "Sözleşme iptal edilemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "contract.cancel",
    entityType: "contract",
    entityId: contract.id,
    oldValue: { title: contract.title, status: contract.status },
    newValue: { status: "cancelled", kaynak: "belge_merkezi" },
  });
  revalidatePath("/app/belgeler");
  revalidatePath("/app/sozlesmeler");
  return { ok: true, deleted: 1 };
}

// ---------------------------------------------------------------------------
// Toplu
// ---------------------------------------------------------------------------

const BULK_LIMIT = 100;

/**
 * Toplu silme — girdi `"kaynak:id"` anahtarları (listedeki seçim anahtarı).
 *
 * Her satır `deleteDocument` üzerinden geçer: yani her satır KENDİ kaynağının
 * iznini yeniden doğrular. Karışık seçimde yetkisiz kaynaklar sessizce
 * atlanmaz — kaç tanesinin neden yapılamadığı geri bildirilir.
 */
export async function bulkDeleteDocuments(keys: string[]): Promise<DocumentResult> {
  const list = Array.from(new Set((keys ?? []).map((k) => String(k).trim()).filter(Boolean))).slice(0, BULK_LIMIT);
  if (list.length === 0) return { error: "Seçim boş." };

  let deleted = 0;
  const failures: string[] = [];

  for (const key of list) {
    const sep = key.indexOf(":");
    if (sep < 1) {
      failures.push("Geçersiz seçim");
      continue;
    }
    const kaynak = key.slice(0, sep);
    const id = key.slice(sep + 1);
    const res = await deleteDocument(kaynak, id);
    if (res.ok) deleted += res.deleted ?? 1;
    else failures.push(res.error ?? "Bilinmeyen hata");
  }

  revalidatePath("/app/belgeler");

  if (deleted === 0) {
    return { error: failures[0] ?? "Hiçbir belge kaldırılamadı." };
  }
  if (failures.length > 0) {
    // Kısmi başarı da bir sonuçtur; sessizce "tamam" demek yanıltıcı olurdu.
    const unique = Array.from(new Set(failures));
    return { ok: true, deleted, error: `${deleted} belge kaldırıldı, ${failures.length} tanesi atlandı: ${unique[0]}` };
  }
  return { ok: true, deleted };
}
