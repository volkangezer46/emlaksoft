-- Rollback: 20260816000900_assignment_rules
-- Kural ayarları silinir; pickAssignee varsayılan (en az yüklü) davranışına döner.
drop table if exists public.assignment_rule_members;
drop table if exists public.assignment_rules;
