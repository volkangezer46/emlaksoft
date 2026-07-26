import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { notifyTenant } from "@/lib/notify";
import { formatTurkishPhone } from "@/lib/phone";

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

type SavedSearch = {
  id: string;
  tenant_id: string;
  name: string | null;
  phone: string;
  tx_type: string;
  province_id: string;
  district_id: string | null;
  min_price: number | null;
  max_price: number | null;
  rooms: string | null;
};

type LiveProperty = {
  id: string;
  title: string | null;
  property_code: string;
  transaction_type: string | null;
  list_price: number | null;
  province_id: string | null;
  district_id: string | null;
  features: unknown;
};

/** transaction_type serbest metin ('Kiralık', 'rent', 'Satılık'…) → satilik/kiralik. */
function txKey(t: string | null): "satilik" | "kiralik" {
  const s = (t ?? "").toLowerCase();
  return s.includes("kira") || s === "rent" ? "kiralik" : "satilik";
}

function matches(s: SavedSearch, p: LiveProperty): boolean {
  if (txKey(p.transaction_type) !== s.tx_type) return false;
  if (!p.province_id || p.province_id !== s.province_id) return false;
  if (s.district_id && p.district_id !== s.district_id) return false;
  const price = p.list_price != null ? Number(p.list_price) : null;
  if (s.min_price != null && (price == null || price < Number(s.min_price))) return false;
  if (s.max_price != null && (price == null || price > Number(s.max_price))) return false;
  if (s.rooms) {
    const rooms = ((p.features ?? {}) as { rooms?: string }).rooms;
    if (rooms !== s.rooms) return false;
  }
  return true;
}

/**
 * Vitrin kayıtlı arama eşleştirme cron'u.
 *
 * Son 24 saatte yayına giren ilanları vitrin_saved_searches kayıtlarıyla
 * eşleştirir; eşleşme bulunca TENANT'a bildirim yazar ("X'i arayın") ve
 * last_notified_at günceller. Ziyaretçiye SMS GÖNDERİLMEZ — maliyet; arama
 * danışmanın işidir.
 *
 * "Yayına giriş" ölçüsü GERÇEK yayın damgasıdır: published_at >= 24 saat
 * (status→live'da bir kez set edilir). Fiyat düzeltmesi gibi alakasız
 * update'ler artık yanlış pozitif üretmez; 24 saatlik last_notified_at freni
 * aynı aramaya tekrarlı bildirimi ayrıca engeller.
 *
 * vercel.json'a DOKUNULMADI — cron path'i elle eklenmeli:
 *   { "path": "/api/cron/vitrin-eslesme", "schedule": "0 9 * * *" }
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // 24 saat içinde zaten bildirilen aramalar atlanır (spam freni)
  const { data: searches } = await admin
    .from("vitrin_saved_searches")
    .select("id, tenant_id, name, phone, tx_type, province_id, district_id, min_price, max_price, rooms")
    .or(`last_notified_at.is.null,last_notified_at.lt.${since}`)
    .limit(1000);

  if (!searches?.length) {
    await recordHeartbeat("vitrin-eslesme", "ok", "kayıtlı arama yok");
    return NextResponse.json({ ok: true, notified: 0 });
  }

  // Tenant başına tek ilan sorgusu (N+1 yerine grupla)
  const byTenant = new Map<string, SavedSearch[]>();
  for (const s of searches as SavedSearch[]) {
    const list = byTenant.get(s.tenant_id) ?? [];
    list.push(s);
    byTenant.set(s.tenant_id, list);
  }

  let notified = 0;

  for (const [tenantId, tenantSearches] of byTenant) {
    const { data: props } = await admin
      .from("properties")
      .select("id, title, property_code, transaction_type, list_price, province_id, district_id, features")
      .eq("tenant_id", tenantId)
      .eq("status", "live")
      .is("deleted_at", null)
      .gte("published_at", since)
      .limit(200);
    if (!props?.length) continue;

    for (const s of tenantSearches) {
      const matched = (props as LiveProperty[]).filter((p) => matches(s, p));
      if (!matched.length) continue;

      const first = matched[0];
      const label = first.title || first.property_code;
      const who = s.name ? `${s.name} adlı ziyaretçiyi` : "ziyaretçiyi";
      const extra = matched.length > 1 ? ` (+${matched.length - 1} ilan daha)` : "";
      await notifyTenant({
        tenantId,
        title: "Kayıtlı aramayla eşleşen yeni ilan",
        body: `"${label}"${extra} kayıtlı aramayla eşleşiyor — ${who} arayın: ${formatTurkishPhone(s.phone)}`,
        href: `/app/portfoyler/${first.id}`,
        kind: "success",
        prefKey: "savedSearch",
      });
      await admin
        .from("vitrin_saved_searches")
        .update({ last_notified_at: new Date().toISOString() })
        .eq("id", s.id);
      notified++;
    }
  }

  await recordHeartbeat("vitrin-eslesme", "ok", `${notified} eşleşme bildirimi`);
  return NextResponse.json({ ok: true, notified, searches: searches.length });
}
