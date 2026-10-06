-- Rollback: 20261007000330_vitrin_chat_context (veri silinmez; vitrin sohbeti "etkin degil" olur)
drop function if exists public.vitrin_chat_context(text, uuid);
notify pgrst, 'reload schema';
