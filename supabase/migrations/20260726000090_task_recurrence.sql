-- Tekrarlayan görevler.
-- recurrence           : null = tekrar yok; periyot tamamlanınca completeTask
--                        sonraki kopyayı üretir (cron YOK, tamamen action içi).
-- recurrence_parent_id : zincirin KÖKÜ (ilk görev). Her kopya köke bağlanır —
--                        kopyanın kopyası da kökü taşır, zincir derinleşmez.
--                        Kök silinirse kopyalar bağımsız kalır (set null).
alter table public.tasks
  add column if not exists recurrence text
    check (recurrence in ('daily','weekly','biweekly','monthly')),
  add column if not exists recurrence_parent_id uuid
    references public.tasks(id) on delete set null;

-- Mükerrer freni: "aynı köke bağlı açık kopya var mı?" sorgusu her tamamlamada çalışır.
create index if not exists idx_tasks_recurrence_parent
  on public.tasks(recurrence_parent_id)
  where recurrence_parent_id is not null;
