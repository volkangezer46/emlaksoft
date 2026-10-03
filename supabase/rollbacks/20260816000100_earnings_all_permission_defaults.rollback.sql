-- Rollback: 20260816000100_earnings_all_permission_defaults
-- ÖNCE 20260816000500 (kazanç gizliliği) geri alınmalı; aksi halde RLS earnings_all'ı bulamaz.
delete from public.permission_defaults where module = 'earnings_all';
