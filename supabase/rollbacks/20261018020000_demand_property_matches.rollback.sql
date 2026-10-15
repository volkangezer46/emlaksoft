-- Geri alma: 20261018020000_demand_property_matches.sql
-- Yeni tablo (politika, indeks ve FK'larıyla) kaldırılır; başka nesne/veri değişmez. Kod tablo yokken eşleşme
-- durumunu boş sayar (eski davranış: gizlenen/gönderilen rozet yok), yazma yolları hatayı yutar.
-- DİKKAT: danışmanların "uygun değil" işaretleri ve gönderim geçmişi satırları silinir (olay geçmişi audit_logs'ta kalır).
drop table if exists public.demand_property_matches;
