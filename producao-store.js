// Persistencia de producao (coleta de pontos) no Supabase
// Substitui JSONL local (perdido no Render por disco efemero)

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('[ProducaoStore] Supabase conectado');
} else {
  console.error('[ProducaoStore] SUPABASE_URL/SUPABASE_ANON_KEY nao configuradas — modo degradado (somente RAM)');
}

function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

class ProducaoStore {
  constructor() {
    this.snapshot = new Map(); // key -> reg (cache do dia)
    this.pontosVisitadosHoje = new Set(); // pontoId's visitados hoje
  }

  /**
   * Insere um registro de producao no Supabase
   * @param {object} reg - registro com equipeId, equipeNome, etc.
   * @returns {Promise<boolean>}
   */
  async append(reg) {
    const data = todayStr(new Date(reg.ts || Date.now()));
    const key = `${data}:${reg.equipeId}:${reg.pontoNumero || 'SEM-PONTO'}`;
    this.snapshot.set(key, reg);
    if (reg.pontoId) this.pontosVisitadosHoje.add(`${data}:${reg.pontoId}`);

    if (!supabase) return false;

    try {
      const row = {
        equipe_id: reg.equipeId,
        equipe_nome: reg.equipeNome || null,
        ponto_numero: reg.pontoNumero || null,
        cidade: reg.cidade || null,
        ais: reg.ais || null,
        lat: reg.lat,
        lng: reg.lng,
        accuracy: reg.accuracy || null,
        ts: new Date(reg.ts || Date.now()).toISOString(),
        origem: reg.origem || 'live',
        ponto_id: reg.pontoId || null,
        ponto_nome: reg.pontoNome || null,
        ponto_cidade: reg.pontoCidade || null,
        ponto_dist_m: reg.pontoDistM || null
      };

      const { error } = await supabase.from('producao').insert([row]);
      if (error) {
        console.error('[ProducaoStore] erro ao inserir:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error('[ProducaoStore] erro ao salvar:', err.message);
      return false;
    }
  }

  /**
   * Le registros de producao de uma data
   * @param {string} dateStr - YYYY-MM-DD
   * @param {string} [equipeId] - filtro opcional
   * @returns {Promise<Array>}
   */
  async readDay(dateStr, equipeId = null) {
    if (!supabase) return [];

    try {
      const startDate = new Date(`${dateStr}T00:00:00-03:00`);
      const endDate = new Date(`${dateStr}T23:59:59-03:00`);

      let query = supabase
        .from('producao')
        .select('*')
        .gte('ts', startDate.toISOString())
        .lte('ts', endDate.toISOString())
        .order('ts', { ascending: true });

      if (equipeId) {
        query = query.eq('equipe_id', equipeId);
      }

      const { data, error } = await query;
      if (error) {
        console.error('[ProducaoStore] erro ao ler:', error.message);
        return [];
      }

      return (data || []).map(r => ({
        id: r.id,
        equipeId: r.equipe_id,
        equipeNome: r.equipe_nome,
        pontoNumero: r.ponto_numero,
        cidade: r.cidade,
        ais: r.ais,
        lat: r.lat,
        lng: r.lng,
        accuracy: r.accuracy,
        ts: new Date(r.ts).getTime(),
        origem: r.origem,
        pontoId: r.ponto_id,
        pontoNome: r.ponto_nome,
        pontoCidade: r.ponto_cidade,
        pontoDistM: r.ponto_dist_m
      }));
    } catch (err) {
      console.error('[ProducaoStore] erro ao ler:', err.message);
      return [];
    }
  }

  /**
   * Carrega os pontos visitados hoje ao iniciar o NOC
   */
  async loadPontosVisitadosHoje() {
    if (!supabase) return;
    const hoje = todayStr();
    try {
      const rows = await this.readDay(hoje);
      for (const reg of rows) {
        if (reg.pontoId) this.pontosVisitadosHoje.add(`${hoje}:${reg.pontoId}`);
      }
      console.log(`[ProducaoStore] ${this.pontosVisitadosHoje.size} ponto(s) visitado(s) hoje carregado(s)`);
    } catch (err) {
      console.warn('[ProducaoStore] erro ao carregar visitados:', err.message);
    }
  }

  /**
   * Atualiza um campo de um registro de producao
   * @param {number} id - ID do registro
   * @param {object} changes - campos para atualizar (ex: { ponto_numero: 'novo nome' })
   * @returns {Promise<boolean>}
   */
  async update(id, changes) {
    if (!supabase) return false;
    try {
      const { error } = await supabase.from('producao').update(changes).eq('id', id);
      if (error) {
        console.error('[ProducaoStore] erro ao atualizar:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error('[ProducaoStore] erro ao atualizar:', err.message);
      return false;
    }
  }

  /** Retorna snapshot em memoria (compatibilidade) */
  current() {
    return Array.from(this.snapshot.values());
  }

  /** Lista datas com registros */
  async listDates() {
    if (!supabase) return [];
    try {
      const { data, error } = await supabase
        .from('producao')
        .select('ts')
        .order('ts', { ascending: false });

      if (error) throw error;
      const datas = new Set();
      for (const reg of (data || [])) {
        const d = new Date(reg.ts).toISOString().split('T')[0];
        datas.add(d);
      }
      return Array.from(datas).sort().reverse();
    } catch (err) {
      console.error('[ProducaoStore] erro ao listar datas:', err.message);
      return [];
    }
  }

  close() {
    console.log('[ProducaoStore] conexao encerrada');
  }
}

module.exports = { ProducaoStore, todayStr };
