-- ============================================================
-- Tabela: pontos_coletados
-- Dados completos coletados pelo app (localStorage -> Supabase)
-- Checklist e cameras como JSONB para flexibilidade
-- ============================================================

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
  checklist JSONB DEFAULT '{}'::jsonb,
  cameras JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para consultas rápidas
CREATE INDEX IF NOT EXISTS idx_pontos_coletados_equipe ON pontos_coletados (equipe_id);
CREATE INDEX IF NOT EXISTS idx_pontos_coletados_data ON pontos_coletados (data_hora);
CREATE INDEX IF NOT EXISTS idx_pontos_coletados_ponto ON pontos_coletados (ponto_numero);
CREATE INDEX IF NOT EXISTS idx_pontos_coletados_checklist ON pontos_coletados USING gin (checklist jsonb_path_ops);

-- RLS (Row Level Security) — desabilitado por enquanto (acesso via service role no server)
ALTER TABLE pontos_coletados ENABLE ROW LEVEL SECURITY;

-- Policy: permite tudo via service role (server backend)
CREATE POLICY "service_all" ON pontos_coletados
  USING (true)
  WITH CHECK (true);
