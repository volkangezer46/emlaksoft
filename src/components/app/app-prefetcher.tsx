"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { prefetchAppApi } from "@/hooks/use-app-api";

const CRITICAL = ["/api/app/bootstrap"];

const PAGE_MAP: Record<string, string[]> = {
  "/app": ["/api/app/bootstrap"],
  "/app/musteriler": ["/api/app/bootstrap"],
  "/app/portfoyler": ["/api/app/bootstrap"],
  "/app/eslestirme": ["/api/app/bootstrap"],
  "/app/komisyon": ["/api/app/bootstrap"],
  "/app/raporlar": ["/api/app/bootstrap"],
};

export function AppPrefetcher({ tenantId }: { tenantId: string | null }) {
  const pathname = usePathname();

  useEffect(() => {
    if (!tenantId) return;
    for (const url of CRITICAL) void prefetchAppApi(tenantId, url, 20_000);
    const extra = PAGE_MAP[pathname] ?? [];
    const t = window.setTimeout(() => {
      for (const url of extra) void prefetchAppApi(tenantId, url, 45_000);
    }, 200);
    return () => clearTimeout(t);
  }, [tenantId, pathname]);

  return null;
}
