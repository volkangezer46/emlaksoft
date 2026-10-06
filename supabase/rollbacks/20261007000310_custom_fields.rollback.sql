-- Rollback: 20261007000310_custom_fields
-- Ozel alan TANIMLARI ve tum DEGERLERI SILINIR. Once dokum alin:
--   select * from public.custom_field_defs order by tenant_id, entity, position;
--   select * from public.custom_field_values order by tenant_id, entity, record_id;
drop policy if exists custom_field_values_delete on public.custom_field_values;
drop policy if exists custom_field_values_update on public.custom_field_values;
drop policy if exists custom_field_values_insert on public.custom_field_values;
drop policy if exists custom_field_values_select on public.custom_field_values;
drop policy if exists custom_field_defs_delete on public.custom_field_defs;
drop policy if exists custom_field_defs_update on public.custom_field_defs;
drop policy if exists custom_field_defs_insert on public.custom_field_defs;
drop policy if exists custom_field_defs_select on public.custom_field_defs;
drop table if exists public.custom_field_values;
drop table if exists public.custom_field_defs;
drop function if exists public.custom_field_can_write(text, boolean);
drop function if exists public.custom_field_record_visible(text, uuid);
notify pgrst, 'reload schema';
