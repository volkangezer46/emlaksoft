import Link from "next/link";
import { Suspense } from "react";
import { Gauge, Smile, Star, UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatRow } from "@/components/ui/stat-row";
import { daysAgoIso } from "@/lib/clock";
import { customerScores, scoreStats, type StatTask } from "@/lib/surveys/logic";

const WINDOW_DAYS = 180;

/**
 * Danışman 360 "Müşteri memnuniyeti" kartı (anket modülü, son 180 gün): NPS, CSAT, danışman puanı (şablondaki
 * "Danışman puanı" sorusu) ve cevap sayısı. Lig puanı (`nps_promoter`, 9-10) ile aynı eşikler. Kapsam RLS'te
 * (görülemeyen satır gelmez); tablo yoksa kart hiç çizilmez, veri yoksa açık boş durum (sahte sıfır yok).
 */
export function AdvisorSurveyCard({ advisorId }: { advisorId: string }) {
  return (
    <Suspense fallback={null}>
      <Body advisorId={advisorId} />
    </Suspense>
  );
}

async function Body({ advisorId }: { advisorId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("survey_tasks")
    .select("id, event_type, audience, status, score, agent_id, assigned_to")
    .eq("agent_id", advisorId)
    .eq("status", "completed")
    .neq("event_type", "advisor_pulse")
    .gte("completed_at", daysAgoIso(WINDOW_DAYS))
    .limit(1000);
  if (error) return null; // şema yok / erişim yok: kart çizilmez
  const tasks = (data ?? []) as StatTask[];
  const href = `/app/anketler?danisman=${advisorId}#liste`;
  const stats = scoreStats(customerScores(tasks));

  let advisorAvg: { avg: number; n: number } | null = null;
  if (tasks.length > 0) {
    const { data: answers } = await supabase
      .from("survey_answers")
      .select("value_num")
      .eq("tag", "advisor")
      .in("task_id", tasks.map((t) => t.id))
      .limit(1000);
    const adv = scoreStats(((answers ?? []) as { value_num: number | null }[]).filter((a) => a.value_num !== null).map((a) => Number(a.value_num)));
    advisorAvg = adv ? { avg: adv.avg, n: adv.n } : null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Müşteri memnuniyeti</CardTitle>
          <CardDescription>Son {WINDOW_DAYS} günün anket cevapları · 0-10 ölçeği</CardDescription>
        </div>
        <Link href={href} className="focus-ring rounded text-sm font-semibold text-accent-text hover:underline">
          Anketleri gör
        </Link>
      </CardHeader>
      <CardContent>
        {stats === null ? (
          <p className="text-sm text-text-muted">Bu danışmanın işlemlerinde henüz cevaplanmış anket yok.</p>
        ) : (
          <StatRow
            label="Memnuniyet göstergeleri"
            items={[
              { label: "NPS", value: String(stats.nps), href, icon: <Gauge />, hint: `${stats.promoters} destekleyen · ${stats.detractors} kötüleyen` },
              { label: "Memnuniyet (CSAT)", value: `%${stats.csat}`, href, icon: <Smile />, hint: "7-10 veren oranı" },
              {
                label: "Danışman puanı",
                value: advisorAvg ? advisorAvg.avg.toLocaleString("tr-TR") : "—",
                href,
                icon: <UserCheck />,
                hint: advisorAvg ? `${advisorAvg.n} cevap` : "soru cevaplanmamış",
              },
              { label: "Cevap", value: stats.n, href, icon: <Star />, hint: `ort. ${stats.avg.toLocaleString("tr-TR")}` },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}
