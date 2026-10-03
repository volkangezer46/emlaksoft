-- Rollback: 20260815000100_loss_reason_stage_label_definitions
-- Global seed satırları kaldırılır. Ofislerin kendi tenant satırlarına dokunulmaz;
-- kod varsayılanlara (definition-defaults.ts) düşer.
delete from public.definitions
 where tenant_id is null
   and category in ('loss_reason', 'deal_stage_label');
