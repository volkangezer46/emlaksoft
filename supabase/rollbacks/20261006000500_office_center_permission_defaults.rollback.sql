-- Rollback: 20261006000500_office_center_permission_defaults
-- ONCE 20261006000510 (pool_assignments) geri alinmali; aksi halde RLS office_center iznini bulamaz ve tablo kapanir.
delete from public.permission_defaults where module = 'office_center';
