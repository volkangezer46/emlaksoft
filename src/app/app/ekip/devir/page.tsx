import Link from "@/components/ui/smart-link";
import { ArrowLeftRight, Info, Lock, UsersRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { PageHeader } from "@/components/ui/page-header";
import { StatRow } from "@/components/ui/stat-row";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { HANDOFF_FSBO_OPEN_STATUSES, handoffEditableScopes } from "@/lib/team/handoff";
import { MemberHandoff } from "../[id]/member-handoff";
import { ROLE_LABELS } from "@/lib/role-labels";
import { IconChip } from "@/components/ui/icons";

export const metadata = { title: "Danışman devri · Ekip" };


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TeamHandoffPage({ searchParams }: { searchParams?: Promise<{ from?: string }> }) {
  const { tenantId, perms } = await requireModulePage("team", "/app/ekip");
  const canHandoff = (perms.team ?? []).includes("edit");
  const editableScopes = handoffEditableScopes(perms);
  const sp = (await searchParams) ?? {};
  const fromParam = UUID_RE.test(sp.from ?? "") ? sp.from! : "";

  const supabase = await createClient();
  // Üye listesi + müşteri sayıları paralel. Portföy sayısı eskiden 5000 satır çekilip bellekte sayılıyordu;
  // artık üye başına tek "head count" (satır taşımaz) paralel koşar.
  const [membersRes, countsRes] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role, is_active").order("full_name").limit(500),
    tenantId
      ? supabase.rpc("customer_counts_by_advisor", { p_tenant_id: tenantId })
      : Promise.resolve({ data: [] as { assigned_to: string; cnt: number }[], error: null }),
  ]);

  const failed = Boolean(membersRes.error);
  const members = (membersRes.data ?? []) as { id: string; full_name: string; role: string; is_active: boolean }[];
  const customerBy = new Map<string, number>();
  for (const r of (countsRes.data ?? []) as { assigned_to: string; cnt: number }[]) {
    customerBy.set(r.assigned_to, Number(r.cnt) || 0);
  }
  const propertyBy = new Map<string, number>();
  const fsboBy = new Map<string, number>();
  // Üye başına portföy ve açık sahibinden adayı "head count"ları paralel (satır taşımaz). Aday tablosu yoksa
  // (sahibinden modülü migration'ı uygulanmadı) sayım hata verir ve 0 sayılır.
  const scoped = members.slice(0, 200);
  const [propCounts, fsboCounts] = await Promise.all([
    Promise.all(
      scoped.map((m) =>
        supabase
          .from("properties")
          .select("id", { count: "exact", head: true })
          .is("deleted_at", null)
          .eq("assigned_to", m.id)
          .then((r) => [m.id, r.count ?? 0] as const),
      ),
    ),
    Promise.all(
      scoped.map((m) =>
        supabase
          .from("fsbo_leads")
          .select("id", { count: "exact", head: true })
          .is("deleted_at", null)
          .eq("assigned_to", m.id)
          .in("status", [...HANDOFF_FSBO_OPEN_STATUSES])
          .then((r) => [m.id, r.error ? 0 : (r.count ?? 0)] as const),
      ),
    ),
  ]);
  for (const [id, n] of propCounts) if (n > 0) propertyBy.set(id, n);
  for (const [id, n] of fsboCounts) if (n > 0) fsboBy.set(id, n);
  const workOf = (id: string) => (customerBy.get(id) ?? 0) + (propertyBy.get(id) ?? 0) + (fsboBy.get(id) ?? 0);

  const active = members.filter((m) => m.is_active);
  const inactiveWithWork = members.filter((m) => !m.is_active && workOf(m.id) > 0);
  // Önce devredilecek işi olan pasifler, sonra aktifler (en çok iş yükü üstte).
  const ordered = [
    ...inactiveWithWork,
    ...[...active].sort((a, b) => workOf(b.id) - workOf(a.id) || a.full_name.localeCompare(b.full_name, "tr")),
  ];

  return (
    <div className="space-y-5">
      <PageHeader icon={<IconChip icon={ArrowLeftRight} size="lg" />}
        eyebrow="Ekip"
        title="Danışman devri"
        description="Bir danışmanın müşteri, portföy (havuz atamalarıyla), açık anlaşma, görev, randevu ve sahibinden ilan takiplerini başka bir danışmana tek seferde devredin. Her devir denetim kaydına yazılır."
      />

      {failed ? (
        <EmptyState
          icon={Info}
          tone="danger"
          illustration="error"
          title="Ekip listesi yüklenemedi"
          description="Üyeler şu an okunamadı. Sayfayı yenileyin."
        />
      ) : members.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          illustration="ekip"
          title="Devredilecek ekip yok"
          description="Ofise danışman eklendiğinde iş yükü devri burada yapılır."
          action={{ href: "/app/ekip", label: "Ekibe danışman ekle" }}
        />
      ) : (
        <>
          {/* Tek gerçek sayı (pasif üyede kalan iş) + iki bağlantı düğmesi; sayı gibi görünen bağlantı kartı yok. */}
          <div className="flex flex-wrap items-center gap-2">
            <StatRow
              label="Devir özeti"
              className="min-w-0 flex-1"
              items={[
                {
                  label: "Pasif üyede kalan iş",
                  value: inactiveWithWork.length,
                  href: "/app/ekip?durum=pasif",
                  hint: "devredilmeli",
                  attention: inactiveWithWork.length > 0,
                },
              ]}
            />
            <ButtonLink href="/app/musteriler" variant="secondary" size="sm">
              Toplu müşteri ata
            </ButtonLink>
            <ButtonLink href="/app/ekip/izinler" variant="secondary" size="sm">
              İzinli üyeler
            </ButtonLink>
          </div>

          {!canHandoff ? (
            <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3 text-sm text-text-muted">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>Devir işlemi için ekip düzenleme yetkisi gerekir. Aşağıda iş yükü yalnız görüntülenir.</p>
            </div>
          ) : null}

          <ul className="space-y-2">
            {ordered.map((m) => {
              const c = customerBy.get(m.id) ?? 0;
              const p = propertyBy.get(m.id) ?? 0;
              const f = fsboBy.get(m.id) ?? 0;
              const others = active.filter((a) => a.id !== m.id).map((a) => ({ id: a.id, full_name: a.full_name }));
              return (
                <li key={m.id} className="surface-card rounded-[var(--radius-card)] p-4">
                  <details open={m.id === fromParam}>
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="min-w-0 flex-1">
                        <Link href={`/app/ekip/${m.id}`} className="focus-ring font-semibold text-ink-950 hover:text-brand-600 hover:underline">
                          {m.full_name}
                        </Link>
                        <span className="ml-2 text-xs text-text-faint">{ROLE_LABELS[m.role] ?? m.role}</span>
                        {!m.is_active ? (
                          <span className="ml-2 rounded-full bg-danger-500/10 px-2 py-0.5 text-xs font-bold text-danger-600">Pasif</span>
                        ) : null}
                      </span>
                      <Link href={`/app/musteriler?assigned=${m.id}`} className="focus-ring text-sm text-text-muted hover:text-brand-600 hover:underline">
                        {c} müşteri
                      </Link>
                      <Link
                        href={`/app/portfoyler?danisman=${m.id}`}
                        className="focus-ring text-sm text-text-muted hover:text-brand-600 hover:underline"
                      >
                        {p} portföy
                      </Link>
                      {f > 0 ? (
                        <Link
                          href={`/app/portfoy-avi?danisman=${m.id}`}
                          className="focus-ring text-sm text-text-muted hover:text-brand-600 hover:underline"
                        >
                          {f} sahibinden ilan takibi
                        </Link>
                      ) : null}
                      {canHandoff ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700">
                          <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden /> Devret
                        </span>
                      ) : null}
                    </summary>
                    {canHandoff ? (
                      <div className="mt-3 border-t border-line pt-3">
                        <MemberHandoff
                          fromId={m.id}
                          fromName={m.full_name}
                          advisors={others}
                          editableScopes={editableScopes}
                        />
                      </div>
                    ) : null}
                  </details>
                </li>
              );
            })}
          </ul>

          <p className="text-xs text-text-faint">
            Devir kapsamı panelde seçilir: müşteri (açık talepler dahil), portföy (havuzdan yapılmış atamalarıyla birlikte), açık anlaşma, açık görev,
            yaklaşan randevu ve açık sahibinden ilan takibi. Seçilen kalemler tek işlemde taşınır; bir adım hata verirse hiçbir kayıt değişmez. Her kalem
            için ilgili modülde düzenleme yetkisi gerekir; gerekçe zorunludur ve denetim kaydına yazılır.
          </p>
        </>
      )}
    </div>
  );
}
