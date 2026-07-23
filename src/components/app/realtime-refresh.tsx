"use client";

import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";

/** App layout: kritik tablolarda değişiklik → soft refresh */
export function RealtimeRefresh({ tenantId }: { tenantId: string | null }) {
  useRealtimeRefresh({
    tenantId,
    tables: ["notifications", "deals", "commissions", "portal_listings", "customers"],
    debounceMs: 600,
  });
  return null;
}
