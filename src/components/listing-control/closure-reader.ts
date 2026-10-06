import type { Db } from "@/lib/listing-control/server/db";
import { evaluateClosureChecklist, type ClosureChecklist, type ClosureFacts } from "@/lib/listing-control/closure-checklist";
import type { ExitKind } from "@/lib/listing-control/types";

/**
 * Kapanış kontrol listesi gerçekleri (sayfa-yerel). Yalnız okunabilen maddeler dolar; okunamayan/izlenmeyen madde
 * `null` = "ölçülemedi" olarak kalır (eksik sayılmaz, sahte tamam da yazılmaz). Tahsilat ve evrak listesi bu ekranda
 * ölçülmez (ilgili modüllerde izlenir).
 */
export async function loadClosureChecklist(
  db: Db,
  propertyId: string,
  exitKind: ExitKind,
  portalsStillLive: boolean | null,
): Promise<ClosureChecklist> {
  const { data: deals, error: dealErr } = await db
    .from("deals")
    .select("id, stage, deal_value, customer_id, updated_at")
    .eq("property_id", propertyId)
    .order("updated_at", { ascending: false })
    .limit(10);
  const rows = dealErr ? null : ((deals ?? []) as { id: string; stage: string; deal_value: number | null; customer_id: string | null; updated_at: string }[]);
  const won = rows?.find((d) => d.stage === "won") ?? null;

  let commission: boolean | null = null;
  if (won) {
    const { count, error } = await db.from("commissions").select("id", { count: "exact", head: true }).eq("deal_id", won.id);
    commission = error ? null : (count ?? 0) > 0;
  }
  const { count: contractCount, error: contractErr } = await db
    .from("contracts")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId);

  const deal = exitKind === "sold" || exitKind === "rented";
  const facts: ClosureFacts = {
    exitKind,
    portalsRemoved: portalsStillLive === null ? null : !portalsStillLive,
    hasReasonRecorded: null,
    dealRecorded: rows === null ? null : won !== null,
    finalPriceRecorded: !deal ? null : rows === null ? null : won ? won.deal_value !== null && Number(won.deal_value) > 0 : false,
    commissionRecorded: commission === null && won === null && rows !== null ? false : commission,
    closedDateRecorded: !deal ? null : rows === null ? null : won ? true : false,
    counterpartyRecorded: !deal ? null : rows === null ? null : won ? won.customer_id !== null : false,
    contractRecorded: contractErr ? null : (contractCount ?? 0) > 0,
    collectionRecorded: null,
    documentsComplete: null,
  };
  return evaluateClosureChecklist(facts);
}
