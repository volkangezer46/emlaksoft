"use client";

import { useState } from "react";
import { Megaphone, PanelTop } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { SegmentBuilder, type SegmentCount, type SegmentOptions } from "./segment-builder";

/**
 * Segmentler sekmesi: ölçütleri deneyip canlı sayımı görün; aynı segmentle duyuru ya da banner başlatın
 * (segment URL ile forma taşınır, kayıtlı segment tablosu yok — gönderim anında yeniden çözülür).
 */
export function SegmentExplorer({ options }: { options: SegmentOptions }) {
  const [query, setQuery] = useState("");
  const [count, setCount] = useState<SegmentCount>(null);
  const suffix = query ? `&${query}` : "";
  return (
    <section className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div>
        <h2 className="font-display font-bold text-ink-950">Segment oluşturucu</h2>
        <p className="mt-1 text-sm text-text-muted">
          Ölçütler birlikte (VE) uygulanır; iptal edilmiş ofisler hiçbir segmentte yer almaz. Sayım canlıdır, gönderim anında yeniden hesaplanır.
        </p>
      </div>
      <form onSubmit={(e) => e.preventDefault()} className="grid gap-4 sm:grid-cols-2">
        <SegmentBuilder
          options={options}
          allowUser={false}
          onChange={({ query: q, count: c }) => {
            setQuery(q);
            setCount(c);
          }}
        />
      </form>
      <div className="flex flex-wrap gap-2">
        <ButtonLink variant="navy" size="md" href={`/admin/duyuru?yeni=1${suffix}`}>
          <Megaphone className="h-4 w-4" /> Bu segmente duyuru{count ? ` (${count.recipients} kişi)` : ""}
        </ButtonLink>
        <ButtonLink variant="outline" size="md" href={`/admin/duyuru?sekme=banner${suffix}#banner-formu`}>
          <PanelTop className="h-4 w-4" /> Bu segmente banner{count ? ` (${count.tenants} ofis)` : ""}
        </ButtonLink>
      </div>
    </section>
  );
}
