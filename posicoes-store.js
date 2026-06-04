// Persistencia de posicoes GPS no Supabase (PostgreSQL)
// - Armazenamento na nuvem (persistente)
// - Sem problemas com disco efêmero do Render
// - Consultas via SQL otimizadas com índices

const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

// Inicializa cliente Supabase com variáveis de ambiente
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('[Supabase] ERRO: SUPABASE_URL e SUPABASE_ANON_KEY não configuradas!');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: { transport: ws }
});

function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

class PosicoesStore {
  constructor() {
    this.snapshot = new Map(); // equipeId -> ultima posicao (estado atual em memoria)
    this.cache = new Map();    // cache para evitar consultas repetidas
    this._loadSnapshot();
  }

  /**
   * Carrega a ultima posicao de cada equipe do banco
   * Executado no boot para bootstrap rápido do NOC
   */
  async _loadSnapshot() {
    try {
      const { data, error } = await supabase
        .from('posicoes')
        .select('*')
        .order('ts', { ascending: false });
      
      if (error) throw error;
      
      // Pega a ultima posicao de cada equipe
      const ultimasPorEquipe = new Map();
      for (const reg of (data || [])) {
        if (!ultimasPorEquipe.has(reg.equipe_id)) {
          // Converte de snake_case para camelCase para compatibilidade
          ultimasPorEquipe.set(reg.equipe_id, {
            equipeId: reg.equipe_id,
            equipeNome: reg.equipe_nome,
            lat: reg.lat,
            lng: reg.lng,
            speed: reg.speed,
            heading: reg.heading,
            accuracy: reg.accuracy,
            ts: new Date(reg.ts).getTime()
          });
        }
      }
      
      this.snapshot = ultimasPorEquipe;
      console.log(`[Supabase] snapshot inicial: ${this.snapshot.size} equipe(s)`);
    } catch (err) {
      console.warn('[Supabase] erro ao carregar snapshot:', err.message);
    }
  }

  /**
   * Grava uma posicao no Supabase e atualiza o snapshot em memoria
   * @param {object} reg  {equipeId, equipeNome, lat, lng, speed, heading, accuracy, ts}
   */
  async append(reg) {
    try {
      // Converte de camelCase para snake_case (padrao do Supabase)
      const registro = {
        equipe_id: reg.equipeId,
        equipe_nome: reg.equipeNome,
        ponto_numero: reg.pontoNumero || null,
        lat: reg.lat,
        lng: reg.lng,
        speed: reg.speed || null,
        heading: reg.heading || null,
        accuracy: reg.accuracy || null,
        ts: new Date(reg.ts || Date.now())
      };

      const { error } = await supabase
        .from('posicoes')
        .insert([registro]);

      if (error) {
        console.error('[Supabase] erro ao inserir:', error.message);
        return false;
      }

      // Atualiza snapshot em memoria
      this.snapshot.set(reg.equipeId, reg);
      return true;
    } catch (err) {
      console.error('[Supabase] erro ao salvar posicao:', err.message);
      return false;
    }
  }

  /** Retorna o estado atual de todas as equipes (para bootstrap WS) */
  current() {
    return Array.from(this.snapshot.values());
  }

  /** Remove uma equipe do snapshot (logout) */
  remove(equipeId) {
    this.snapshot.delete(equipeId);
  }

  /**
   * Le todas as posicoes de um dia em ordem cronologica
   * @param {string} dateStr YYYY-MM-DD
   * @param {string} [equipeId] filtro opcional
   * @returns {Promise<Array>}
   */
  async readDay(dateStr, equipeId = null) {
    try {
      // Converte a data para timestamp do dia
      const startDate = new Date(`${dateStr}T00:00:00-03:00`);
      const endDate = new Date(`${dateStr}T23:59:59-03:00`);
      
      let query = supabase
        .from('posicoes')
        .select('*')
        .gte('ts', startDate.toISOString())
        .lte('ts', endDate.toISOString())
        .order('ts', { ascending: true });
      
      if (equipeId) {
        query = query.eq('equipe_id', equipeId);
      }
      
      const { data, error } = await query;
      
      if (error) {
        console.error('[Supabase] erro ao ler posicoes:', error.message);
        return [];
      }
      
      // Converte de snake_case para camelCase (compatibilidade)
      const out = (data || []).map(reg => ({
        equipeId: reg.equipe_id,
        equipeNome: reg.equipe_nome,
        pontoNumero: reg.ponto_numero,
        lat: reg.lat,
        lng: reg.lng,
        speed: reg.speed,
        heading: reg.heading,
        accuracy: reg.accuracy,
        ts: new Date(reg.ts).getTime()
      }));
      
      return out;
    } catch (err) {
      console.error('[Supabase] erro ao ler posicoes do dia:', err.message);
      return [];
    }
  }

  /**
   * Lista de datas com registros disponiveis
   * @returns {Promise<Array<string>>}
   */
  async listDates() {
    try {
      const { data, error } = await supabase
        .from('posicoes')
        .select('ts')
        .order('ts', { ascending: false });
      
      if (error) throw error;
      
      // Extrai datas unicas
      const datas = new Set();
      for (const reg of (data || [])) {
        const date = new Date(reg.ts).toISOString().split('T')[0];
        datas.add(date);
      }
      
      return Array.from(datas).sort().reverse();
    } catch (err) {
      console.error('[Supabase] erro ao listar datas:', err.message);
      return [];
    }
  }

  // Métodos mantidos para compatibilidade (não fazem nada no Supabase)
  close() {
    // Nada a fechar - conexão é gerenciada pelo Supabase
    console.log('[Supabase] conexão encerrada');
  }
}

module.exports = { PosicoesStore, todayStr };
