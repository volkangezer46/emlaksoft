-- 20261012001710 geri alma: yalniz arama indeksleri duser (veri etkilenmez; arama yavaslar).
drop index if exists public.idx_tasks_title_trgm;
drop index if exists public.idx_tasks_notes_trgm;
drop index if exists public.idx_customer_files_file_name_trgm;
drop index if exists public.idx_customer_files_label_trgm;
drop index if exists public.idx_property_media_file_name_trgm;
drop index if exists public.idx_contracts_title_trgm;
drop index if exists public.idx_deal_checklist_items_label_trgm;
drop index if exists public.idx_deal_checklist_items_file_url_trgm;
