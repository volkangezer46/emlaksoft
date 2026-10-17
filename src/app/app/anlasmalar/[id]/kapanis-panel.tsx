import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { getRequestProfile } from "@/lib/cache/request";
import { getSetting } from "@/lib/settings/read";
import { daysFromNowIso, toTrLocalInput } from "@/lib/clock";
import type { KapanisProps } from "./kapanis-sihirbazi";
import { KapanisLazy } from "./kapanis-lazy";
import { COLLECTION_TASK_PREFIX } from "./kapanis-model";
import { CONTRACT_STATUS_LABELS } from "@/app/app/sozlesmeler/contract-list-logic";

type Base = Pick<
  KapanisProps,
  | "dealId"
  | "stage"
  | "dealType"
  | "dealValue"
  | "propertyId"
  | "propertyTitle"
  | "customerId"
  | "customerName"
  | "lossOptions"
  | "lossReasonText"
  | "canEdit"
  | "canCreate"
  | "canCreateTask"
  | "canSurvey"
  | "showMoney"
  | "survey"
  | "requestedOutcome"
  | "userId"
  | "canSetRate"
  | "needsApproval"
  | "propertyStatusLabel"
>;

/**
 * Kapanış sihirbazı veri yükleyicisi (sunucu; sihirbaz `kapanis-sihirbazi.tsx` ortak Sihirbaz çatısında). Sihirbaz yeni sorgu mantığı eklemez: oran portföyden,
 * komisyon/paylar `commissions` satırından, evrak ilerlemesi `deal_checklist_items`'tan okunur.
 * Para alanları yalnız `showMoney` (kendi anlaşması veya earnings_all) iken sorgulanır — başkasının
 * kazancı bu panelden de sızmaz.
 */
export async function KapanisPanel(props: Base) {
  const supabase = await createClient();
  // Ofis Tanımları Merkezi: önerilen danışman payı (ayar yoksa kod varsayılanı 50).
  const user = await getRequestUser();
  const profile = user ? await getRequestProfile(user.id) : null;
  const defaultAdvisorShare = profile?.tenant_id
    ? await getSetting<number>("office.commission.split_advisor_share", { tenantId: profile.tenant_id as string })
    : 50;
  const open = props.stage !== "won" && props.stage !== "lost";
  const [property, commission, checklist, collectionTask, contracts] = await Promise.all([
    props.propertyId
      ? supabase.from("properties").select("commission_rate").eq("id", props.propertyId).maybeSingle()
      : Promise.resolve({ data: null }),
    props.showMoney && props.stage === "won"
      ? supabase
          .from("commissions")
          .select("id, gross_amount, vat_amount, status, splits")
          .eq("deal_id", props.dealId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    props.stage === "won" || open
      ? supabase.from("deal_checklist_items").select("is_done").eq("deal_id", props.dealId)
      : Promise.resolve({ data: null }),
    props.stage === "won" || open
      ? supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("deal_id", props.dealId)
          .ilike("title", `${COLLECTION_TASK_PREFIX}%`)
      : Promise.resolve({ count: 0 }),
    // Kapanış sihirbazının Sözleşme adımı: anlaşmaya kesin bağlı sözleşmeler.
    open
      ? supabase
          .from("contracts")
          .select("id, title, status")
          .eq("deal_id", props.dealId)
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: null }),
  ]);

  const rateRaw = (property.data as { commission_rate: number | null } | null)?.commission_rate;
  const c = commission.data as {
    id: string;
    gross_amount: number | string | null;
    vat_amount: number | string | null;
    status: string | null;
    splits: { label?: string; rate?: number }[] | null;
  } | null;
  const items = (checklist.data ?? []) as { is_done: boolean }[];

  return (
    <KapanisLazy
      // `?sonuc=` değişirse (panodan yeni bir bırakma) sihirbaz o akışla yeniden başlar.
      key={props.requestedOutcome ?? "secim"}
      {...props}
      commissionRate={rateRaw != null ? Number(rateRaw) : null}
      defaultAdvisorShare={defaultAdvisorShare}
      commission={
        c
          ? {
              id: c.id,
              gross: Number(c.gross_amount ?? 0),
              vat: Number(c.vat_amount ?? 0),
              status: c.status ?? "",
              splits: Array.isArray(c.splits) ? c.splits.map((s) => ({ label: s.label ?? "", rate: Number(s.rate ?? 0) })) : [],
            }
          : null
      }
      checklist={{ done: items.filter((x) => x.is_done).length, total: items.length }}
      hasCollectionTask={(collectionTask.count ?? 0) > 0}
      contracts={((contracts.data ?? []) as { id: string; title: string | null; status: string | null }[]).map((c) => ({
        id: c.id,
        title: c.title ?? "Sözleşme",
        statusLabel: c.status ? (CONTRACT_STATUS_LABELS[c.status] ?? c.status) : "—",
      }))}
      defaultDue={toTrLocalInput(daysFromNowIso(7))}
    />
  );
}
