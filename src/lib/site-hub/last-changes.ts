import { queryActivity, resolveActorNames } from "@/lib/admin/activity-query";
import { HUB_CARDS, type HubCardId } from "./cards";

export type LastChange = { at: string; actorName: string | null; action: string };

/** Bir `action` hangi karta ait (ilk eşleşen önek). Saf; testlenir. */
export function cardForAction(action: string): HubCardId | null {
  for (const c of HUB_CARDS) if (c.audit.some((p) => action.startsWith(p))) return c.id;
  return null;
}

/**
 * Her kart için son değişiklik: platform denetim izinden (logPlatformActivity'nin yazdığı kayıtlar) eylem öneklerine göre.
 * Okuma, mevcut ve kabul listesindeki aktivite sorgusu (`activity-query`) üzerinden yapılır; bu dosya service_role açmaz.
 * Dışarı YALNIZ eylem adı, zaman ve personel adı alınır; kayıtların diğer alanları atılır. Hata olursa boş döner.
 * Çağıran `requirePlatformModule` ile kapılar.
 */
export async function readLastChanges(): Promise<Partial<Record<HubCardId, LastChange>>> {
  const out: Partial<Record<HubCardId, LastChange>> = {};
  if (HUB_CARDS.every((c) => c.audit.length === 0)) return out;
  try {
    const res = await queryActivity({ kaynak: "platform" }, 999);
    const picked: Array<{ card: HubCardId; actorId: string | null }> = [];
    for (const r of res.platformRows) {
      const card = cardForAction(r.action);
      if (card && !out[card]) {
        out[card] = { at: r.created_at, actorName: null, action: r.action };
        picked.push({ card, actorId: r.actor_id });
      }
    }
    const ids = [...new Set(picked.map((p) => p.actorId).filter((x): x is string => !!x))];
    if (ids.length) {
      const { platform } = await resolveActorNames(ids, []);
      for (const p of picked) {
        const n = p.actorId ? platform.get(p.actorId) : null;
        if (n) out[p.card]!.actorName = n;
      }
    }
  } catch (e) {
    console.error("readLastChanges", e);
  }
  return out;
}
