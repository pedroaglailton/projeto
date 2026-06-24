// Persistencia de pontos_coletados (dados completos coletados pelo app) no Supabase
// Salva checklist, cameras e observações como JSONB

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('[PontosColetadosStore] Supabase conectado');
} else {
  console.error('[PontosColetadosStore] SUPABASE_URL/SUPABASE_ANON_KEY nao configuradas');
}

class PontosColetadosStore {

  /**
   * Insere um ponto coletado completo no Supabase
   * @param {object} reg - registro com equipe_id, ponto_numero, checklist, cameras, etc.
   * @returns {Promise<object|null>} - registro inserido ou null
   */
  async append(reg) {
    if (!supabase) return null;

    try {
      const row = {
        equipe_id: reg.equipeId || null,
        equipe_nome: reg.equipeNome || null,
        ponto_numero: reg.pontoNumero || null,
        operador: reg.operador || null,
        lat: reg.lat ?? null,
        lng: reg.lng ?? null,
        accuracy: reg.accuracy ?? null,
        endereco: reg.endereco || null,
        observacoes: reg.observacoes || null,
        data_hora: reg.dataHora || new Date().toISOString(),
        checklist: reg.checklist || {},
        cameras: reg.cameras || []
      };

      const { data, error } = await supabase
        .from('pontos_coletados')
        .insert([row])
        .select()
        .single();

      if (error) {
        console.error('[PontosColetadosStore] erro ao inserir:', error.message);
        return null;
      }
      console.log(`[PontosColetadosStore] ponto #${reg.pontoNumero} salvo (id:${data.id})`);
      return data;
    } catch (err) {
      console.error('[PontosColetadosStore] erro ao salvar:', err.message);
      return null;
    }
  }

  /**
   * Atualiza cameras de um ponto coletado (quando edita no app)
   * @param {number} id - ID do registro no Supabase
   * @param {object} changes - campos para atualizar
   * @returns {Promise<boolean>}
   */
  async update(id, changes) {
    if (!supabase) return false;
    try {
      const { error } = await supabase
        .from('pontos_coletados')
        .update(changes)
        .eq('id', id);

      if (error) {
        console.error('[PontosColetadosStore] erro ao atualizar:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error('[PontosColetadosStore] erro ao atualizar:', err.message);
      return false;
    }
  }

  /**
   * Busca pontos coletados de uma equipe em uma data
   * @param {string} dateStr - YYYY-MM-DD
   * @param {string} [equipeId]
   * @returns {Promise<Array>}
   */
  async readDay(dateStr, equipeId = null) {
    if (!supabase) return [];

    try {
      const startDate = new Date(`${dateStr}T00:00:00-03:00`);
      const endDate = new Date(`${dateStr}T23:59:59-03:00`);

      let query = supabase
        .from('pontos_coletados')
        .select('*')
        .gte('data_hora', startDate.toISOString())
        .lte('data_hora', endDate.toISOString())
        .order('data_hora', { ascending: true });

      if (equipeId) {
        query = query.eq('equipe_id', equipeId);
      }

      const { data, error } = await query;
      if (error) {
        console.error('[PontosColetadosStore] erro ao ler:', error.message);
        return [];
      }
      return data || [];
    } catch (err) {
      console.error('[PontosColetadosStore] erro ao ler:', err.message);
      return [];
    }
  }

  /**
   * Remove um registro
   */
  async remove(id) {
    if (!supabase) return false;
    try {
      const { error } = await supabase.from('pontos_coletados').delete().eq('id', id);
      if (error) {
        console.error('[PontosColetadosStore] erro ao remover:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error('[PontosColetadosStore] erro ao remover:', err.message);
      return false;
    }
  }

  close() {
    console.log('[PontosColetadosStore] conexao encerrada');
  }
}

module.exports = { PontosColetadosStore };
