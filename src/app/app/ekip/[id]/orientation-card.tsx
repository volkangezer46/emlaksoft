import Link from "@/components/ui/smart-link";
import { Rocket } from "lucide-react";
import type { createClient } from "@/lib/supabase/server";
import { Progress } from "@/components/ui/progress";
import { now, trDayKey } from "@/lib/clock";
import { isOrientationItemDone, orientationProgress } from "@/lib/recruiting/logic";
import { loadOrientationItems, loadOrientationTemplate } from "@/lib/recruiting/store";
import { OrientationToggle, RemoveOrientationButton, StartOrientationForm } from "./orientation-controls";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Yeni üye sayılma süresi: bu süreden eski üyede liste yoksa "başlat" kartı gösterilmez (eski kadroda gürültü olmasın). */
const NEW_MEMBER_DAYS = 90;

const dayFmt = (key: string) => new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${key}T12:00:00.000Z`));

/**
 * Danışman 360 > Özet: yeni danışman ORYANTASYON kartı (OA9). Liste varsa ilerleme çubuğu + adımlar (üye ve ekip
 * yöneticisi işaretler; bağlı görev eşlenir). Liste yoksa yalnız ekip yöneticisine, yeni ve aktif üyede "başlat" formu.
 * Tablo yoksa kart hiç çizilmez.
 */
export async function OrientationCard({
  supabase,
  tenantId,
  memberId,
  isSelf,
  canManage,
  joinedAt,
  isActive,
}: {
  supabase: Supabase;
  tenantId: string;
  memberId: string;
  isSelf: boolean;
  canManage: boolean;
  joinedAt: string;
  isActive: boolean;
}) {
  const nowMs = now();
  const today = trDayKey(nowMs);
  const res = await loadOrientationItems(supabase, tenantId, memberId);
  if (!res.available) return null;
  const items = res.items;

  if (items.length === 0) {
    const isNew = nowMs - Date.parse(joinedAt) <= NEW_MEMBER_DAYS * 86_400_000;
    if (!canManage || isSelf || !isActive || !isNew) return null;
    const template = await loadOrientationTemplate(supabase, tenantId);
    if (!template.available) return null;
    return (
      <section aria-labelledby={`orient-${memberId}`} className="space-y-3 rounded-[var(--radius-panel)] border border-dashed border-brand-300 bg-brand-600/[0.03] p-4 sm:p-5">
        <div>
          <h2 id={`orient-${memberId}`} className="flex items-center gap-2 text-sm font-bold text-ink-950">
            <Rocket className="h-4 w-4 text-brand-600" aria-hidden /> Yeni danışman oryantasyonu
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            Yetki belgesi, KVKK taahhüdü, portal hesapları, kartvizit ve ilk 30 gün adımları tek listede; danışman kendi ilerlemesini görür.{" "}
            <Link href="/app/ekip/adaylar?sekme=oryantasyon" className="font-semibold text-brand-600 hover:underline">
              Şablonu düzenle
            </Link>
          </p>
        </div>
        <StartOrientationForm profileId={memberId} today={today} stepCount={template.items.length} />
      </section>
    );
  }

  const p = orientationProgress(items, today);
  const canToggle = isSelf || canManage;
  const sorted = [...items].sort((a, b) => Number(isOrientationItemDone(a)) - Number(isOrientationItemDone(b)) || a.sort - b.sort);
  const complete = p.done === p.total;

  return (
    <section aria-labelledby={`orient-${memberId}`} className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={`orient-${memberId}`} className="flex items-center gap-2 text-sm font-bold text-ink-950">
            <Rocket className="h-4 w-4 text-brand-600" aria-hidden /> {isSelf ? "Başlangıç listeniz" : "Oryantasyon"}
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            <span className="numeric font-semibold text-ink-950">
              {p.done}/{p.total}
            </span>{" "}
            adım tamamlandı
            {p.overdue > 0 ? <span className="font-semibold text-amber-700"> · {p.overdue} adımın süresi geçti</span> : null}
            {complete ? <span className="font-semibold text-mint-700"> · Tamamlandı</span> : null}
          </p>
        </div>
        {canManage && !isSelf ? <RemoveOrientationButton profileId={memberId} /> : null}
      </div>
      <Progress value={p.percent} label="Oryantasyon ilerlemesi" tone={complete ? "success" : p.overdue > 0 ? "warning" : "accent"} />
      <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
        {sorted.map((it) => {
          const done = isOrientationItemDone(it);
          const overdue = !done && it.due_on !== null && it.due_on < today;
          return (
            <li key={it.id} className="flex items-center gap-1 pr-3">
              <OrientationToggle id={it.id} done={done} label={it.title} disabled={!canToggle} />
              <span className="min-w-0 flex-1 py-2">
                <span className={`block text-sm ${done ? "text-text-muted line-through" : "text-ink-950"}`}>{it.title}</span>
                <span className="flex flex-wrap gap-x-2 text-xs text-text-muted">
                  {it.description && !done ? <span className="w-full">{it.description}</span> : null}
                  {it.due_on ? <span className={overdue ? "font-semibold text-amber-700" : ""}>Termin {dayFmt(it.due_on)}</span> : null}
                  {it.task_id ? (
                    <Link href={`/app/gorevler?gorev=${it.task_id}`} className="font-semibold text-brand-600 hover:underline">
                      Görevi aç
                    </Link>
                  ) : null}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
