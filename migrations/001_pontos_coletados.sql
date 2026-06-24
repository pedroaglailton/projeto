-- ============================================================
-- Tabela: pontos_coletados (v2 — colunas individuais)
-- Dropar a tabela antiga primeiro:
--   DROP TABLE IF EXISTS pontos_coletados;
-- ============================================================

DROP TABLE IF EXISTS pontos_coletados;

CREATE TABLE IF NOT EXISTS pontos_coletados (
  id BIGSERIAL PRIMARY KEY,
  equipe_id TEXT,
  equipe_nome TEXT,
  ponto_numero TEXT NOT NULL,
  operador TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  accuracy DOUBLE PRECISION,
  endereco TEXT,
  observacoes TEXT,
  data_hora TIMESTAMPTZ,

  -- Dados Gerais
  data_inspecao TEXT,
  ais TEXT,
  cidade_nome TEXT,
  contrato TEXT,
  config_cameras TEXT,

  -- Equipamentos
  caixa_hermetica TEXT,
  status_caixa_hermetica TEXT,
  nobreak TEXT,
  status_nobreak TEXT,

  -- Poste
  poste TEXT,
  poste_status TEXT,
  status_poste TEXT,

  -- Switch / Rede
  switch_cftv TEXT,
  status_switch TEXT,
  onu TEXT,

  -- AP
  radio_ap TEXT,
  switch_ap TEXT,
  status_switch_ap TEXT,

  -- Energia
  caixa_padrao TEXT,
  status_padrao TEXT,
  registro_enel TEXT,

  -- LPR
  lpr01 TEXT,
  lpr01_sentido TEXT,
  lpr02 TEXT,
  lpr02_sentido TEXT,
  lpr03 TEXT,
  lpr03_sentido TEXT,
  lpr04 TEXT,
  lpr04_sentido TEXT,
  ajuste_lpr TEXT,

  -- CPU / Bullet / Switch
  tombo_cpu TEXT,
  tombo_bullet TEXT,
  tombo_switch_cvm TEXT,
  switch_ligado TEXT,
  ajuste_bullet TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_pc_equipe ON pontos_coletados (equipe_id);
CREATE INDEX IF NOT EXISTS idx_pc_data ON pontos_coletados (data_hora);
CREATE INDEX IF NOT EXISTS idx_pc_ponto ON pontos_coletados (ponto_numero);
CREATE INDEX IF NOT EXISTS idx_pc_ais ON pontos_coletados (ais);
CREATE INDEX IF NOT EXISTS idx_pc_cidade ON pontos_coletados (cidade_nome);

-- RLS
ALTER TABLE pontos_coletados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON pontos_coletados USING (true) WITH CHECK (true);
