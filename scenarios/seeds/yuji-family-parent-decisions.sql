-- yuji-family-parent-decisions.sql — seed pre-scenario nagareyama-14d-v1
--
-- Aplicado ANTES do scenario rodar, via scripts/apply-parent-seed.mjs.
--
-- Decisões family-wide usando session_id sentinel "family:<persona>".
-- Motor v1 ainda não consulta nesse formato — visível no DB pós-scenario
-- como evidência das preferências aplicadas. Auto-consultar fica pra v2
-- quando ParentalProfile for refatorado pra ler kids_parent_decisions
-- diretamente do DB ao invés do persona profile YAML estático.
--
-- Mapping categorias → content_ids do seed.json (motor#18 enriched):
--   science     → bio_*, phys_*, chem_*
--   math        → math_*
--   art/culture → cult_*, myth_*
--   nature      → bio_trees_communicate, bio_ant_sacrifice
--   mindfulness → theo_zen_empty_cup, ling_japanese_silence (chinmoku)
--   japanese    → ling_japanese_silence, myth_kintsugi_philosophy
--   psicologia  → psych_marshmallow (esforço), psych_dunbar_150

-- DDL idempotente (motor-execucao já cria mas pode ainda não ter rodado)
CREATE TABLE IF NOT EXISTS kids_parent_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  content_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  decided_at TEXT NOT NULL,
  expires_at TEXT,
  UNIQUE(session_id, content_id)
);

-- ─── YUJI decisions (5 approve + 1 pinned) ──────────────────────────
-- Yuji approve: science, math, esforço/persistência cultural
INSERT OR IGNORE INTO kids_parent_decisions (session_id, content_id, status, reason, decided_at)
VALUES
  ('family:yuji-ochiai', 'bio_dolphin_names',          'approved', 'Yuji approve: science (biologia, hook narrativo)',                  '2026-05-01T00:00:00Z'),
  ('family:yuji-ochiai', 'bio_octopus_hearts',         'approved', 'Yuji approve: science',                                              '2026-05-01T00:00:00Z'),
  ('family:yuji-ochiai', 'phys_gut_brain',             'approved', 'Yuji approve: science (física + biologia integrada)',                '2026-05-01T00:00:00Z'),
  ('family:yuji-ochiai', 'phys_observer_effect',       'approved', 'Yuji approve: physics conceitual',                                   '2026-05-01T00:00:00Z'),
  ('family:yuji-ochiai', 'psych_marshmallow',          'approved', 'Yuji approve: esforço acima de resultado',                           '2026-05-01T00:00:00Z'),
  ('family:yuji-ochiai', 'myth_kintsugi_philosophy',   'pinned',   'Yuji pinned: kintsugi — esforço acumulado vira beleza (cultura japonesa)', '2026-05-01T00:00:00Z');

-- ─── YUKO decisions (4 approve + 1 pinned) ─────────────────────────
-- Yuko approve: mindfulness, cultura japonesa, natureza
INSERT OR IGNORE INTO kids_parent_decisions (session_id, content_id, status, reason, decided_at)
VALUES
  ('family:yuko-ochiai', 'theo_zen_empty_cup',         'approved', 'Yuko approve: mindfulness (zen)',                                    '2026-05-01T00:00:00Z'),
  ('family:yuko-ochiai', 'ling_japanese_silence',      'approved', 'Yuko approve: cultura japonesa (chinmoku — silêncio pesado)',         '2026-05-01T00:00:00Z'),
  ('family:yuko-ochiai', 'cult_swedish_fika',          'approved', 'Yuko approve: cultura social (fika — pausa coletiva)',                '2026-05-01T00:00:00Z'),
  ('family:yuko-ochiai', 'bio_trees_communicate',      'approved', 'Yuko approve: nature',                                                '2026-05-01T00:00:00Z'),
  ('family:yuko-ochiai', 'myth_kintsugi_philosophy',   'pinned',   'Yuko pinned: kintsugi — pais alinhados',                              '2026-05-01T00:00:00Z');

-- Total esperado: 6 (Yuji) + 5 (Yuko) = 11 decisions
