"use server";

import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { escapeCsvCell } from "@/lib/csv";
import { trDayKey } from "@/lib/clock";
import { auditActionLabel } from "@/lib/admin-format";
import { parseActivityFilters, queryActivity, resolveActorNames } from "@/lib/admin/activity-query";
import type { ExportResult } from "@/app/actions/platform-export";

const EXPORT_LIMIT = 5000;

/**
 * Aktivite kaydını CSV olarak dışa aktarır. Ekrandaki süzgeç AYNEN uygulanır (`queryActivity`);
 * en yeni 5000 kayıtla sınırlıdır. Dışa aktarma da denetim kaydına yazılır.
 */
export async function exportActivityCsv(params: Record<string, string | undefined>): Promise<ExportResult> {
  const staff = await requirePlatformModule("activity");

  const { allowed } = await checkRateLimit(`activity-export:${staff.id}`, {
    limit: 10,
    windowSec: 600,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok sık dışa aktarıldı. Lütfen biraz sonra tekrar deneyin." };

  const filters = parseActivityFilters(params);
  const res = await queryActivity(filters, EXPORT_LIMIT - 1);

  const names = await resolveActorNames(
    [...new Set(res.platformRows.map((r) => r.actor_id).filter(Boolean))] as string[],
    [...new Set(res.tenantRows.map((r) => r.actor_id).filter(Boolean))] as string[],
  );

  const rows = [
    ...res.platformRows.map((r) => ({
      tarih: r.created_at,
      kaynak: "Platform",
      ofis: "",
      kisi: r.actor_id ? (names.platform.get(r.actor_id) ?? r.actor_id) : "Sistem",
      islem: auditActionLabel(r.action),
      islem_kodu: r.action,
      varlik: r.entity_type ?? "",
      varlik_id: r.entity_id ?? "",
      ayrinti: r.meta == null ? "" : JSON.stringify(r.meta).slice(0, 1000),
    })),
    ...res.tenantRows.map((r) => {
      const t = Array.isArray(r.tenant) ? r.tenant[0] : r.tenant;
      return {
        tarih: r.created_at,
        kaynak: "Ofis",
        ofis: t?.name ?? "",
        kisi: r.actor_id ? (names.tenant.get(r.actor_id) ?? r.actor_id) : "Sistem",
        islem: auditActionLabel(r.action),
        islem_kodu: r.action,
        varlik: r.entity_type ?? "",
        varlik_id: r.entity_id ?? "",
        ayrinti:
          r.old_value == null && r.new_value == null
            ? ""
            : JSON.stringify({ eski: r.old_value ?? null, yeni: r.new_value ?? null }).slice(0, 1000),
      };
    }),
  ]
    .sort((a, b) => (a.tarih < b.tarih ? 1 : -1))
    .slice(0, EXPORT_LIMIT);

  if (rows.length === 0) return { error: "Dışa aktarılacak kayıt yok." };

  await logPlatformActivity({
    actorId: staff.id,
    action: "activity.export",
    entityType: "audit",
    meta: { rows: rows.length, filters },
  });

  const keys = Object.keys(rows[0]!) as (keyof (typeof rows)[number])[];
  const csv =
    "﻿" + [keys.join(","), ...rows.map((r) => keys.map((k) => escapeCsvCell(r[k])).join(","))].join("\n");
  return { csv, filename: `aktivite-${trDayKey()}.csv` };
}
