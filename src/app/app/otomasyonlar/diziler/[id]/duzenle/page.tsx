import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { IconChip } from "@/components/ui/icons";
import { ICONS } from "@/lib/icons";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { SequenceEditor } from "../../sequence-editor";

export const metadata = { title: "Otomatik takibi düzenle" };

export default async function DiziDuzenlePage({ params }: { params: Promise<{ id: string }> }) {
  const { perms } = await requireModulePage("settings", "/app/otomasyonlar");
  if (!(perms.settings ?? []).includes("edit")) notFound();
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: seq }, { data: steps }] = await Promise.all([
    supabase.from("message_sequences").select("id, name, description, is_active, stop_on_reply, daily_cap").eq("id", id).maybeSingle(),
    supabase.from("message_sequence_steps").select("step_type, delay_days, config, sort_order").eq("sequence_id", id).order("sort_order"),
  ]);
  if (!seq) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        icon={<IconChip icon={ICONS.secimListesi} tone="brand" size="lg" />}
        title="Diziyi düzenle"
        eyebrow="Otomatik takip mesajları"
        description="Adım değişikliği devam eden müşterilerde kaldıkları adımdan itibaren uygulanır."
        breadcrumbs={[
          { label: "Otomatik takip mesajları", href: "/app/otomasyonlar/diziler" },
          { label: String(seq.name), href: `/app/otomasyonlar/diziler/${id}` },
          { label: "Düzenle" },
        ]}
      />
      <SequenceEditor
        initial={{
          id: String(seq.id),
          name: String(seq.name),
          description: (seq.description as string | null) ?? null,
          is_active: Boolean(seq.is_active),
          stop_on_reply: Boolean(seq.stop_on_reply),
          daily_cap: Number(seq.daily_cap ?? 200),
          steps: ((steps ?? []) as { step_type: string; delay_days: number; config: Record<string, unknown> }[]).map((s) => ({
            step_type: s.step_type,
            delay_days: s.delay_days,
            config: s.config ?? {},
          })),
        }}
      />
    </div>
  );
}
