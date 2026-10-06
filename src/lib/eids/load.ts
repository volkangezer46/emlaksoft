import type { SupabaseClient } from "@supabase/supabase-js";
import { now } from "@/lib/clock";
import { summarizeEids, type EidsPropertyRow, type EidsSummary } from "./status";

/**
 * EİDS durum okuyucusu — oturumlu istemci (RLS), service_role yok. Kolon okunamazsa `enabled:false` döner
 * (migration uygulanmamış ortamda uydurma sayı yok).
 */
const SCAN = 2000;
/** Liste sorgusuna `id in (...)` olarak inen en çok kimlik (PostgREST URL sınırı). */
export const EIDS_ID_CAP = 150;

export type EidsStatusLoad = { enabled: false } | { enabled: true; summary: EidsSummary; truncated: boolean };

export async function loadEidsStatus(supabase: SupabaseClient): Promise<EidsStatusLoad> {
  const { data, error } = await supabase
    .from("properties")
    .select("id, status, eids_property_no, authorization_start, authorization_end")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(SCAN);
  if (error) return { enabled: false };
  const rows = (data ?? []) as EidsPropertyRow[];
  return { enabled: true, summary: summarizeEids(rows, now()), truncated: rows.length >= SCAN };
}
