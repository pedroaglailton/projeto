// Persistencia de pontos_coletados (dados completos coletados pelo app) no Supabase
// Checklist como colunas individuais

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

  get client() {
    return supabase;
  }

  /**
   * Insere um ponto coletado completo no Supabase
   * @param {object} reg - registro com equipe_id, ponto_numero, checklist, cameras, etc.
   * @returns {Promise<object|null>} - registro inserido ou null
   */
  async append(reg) {
    if (!supabase) return null;

    try {
      const row = {
        equipe_id: reg.equipe_id || null,
        equipe_nome: reg.equipe_nome || null,
        ponto_numero: reg.ponto_numero || null,
        operador: reg.operador || null,
        lat: reg.lat ?? null,
        lng: reg.lng ?? null,
        accuracy: reg.accuracy ?? null,
        endereco: reg.endereco || null,
        observacoes: reg.observacoes || null,
        data_hora: reg.data_hora || new Date().toISOString(),
        data_inspecao: reg.data_inspecao || null,
        ais: reg.ais || null,
        cidade_nome: reg.cidade_nome || null,
        contrato: reg.contrato || null,
        config_cameras: reg.config_cameras || null,
        caixa_hermetica: reg.caixa_hermetica || null,
        status_caixa_hermetica: reg.status_caixa_hermetica || null,
        nobreak: reg.nobreak || null,
        status_nobreak: reg.status_nobreak || null,
        poste: reg.poste || null,
        poste_status: reg.poste_status || null,
        status_poste: reg.status_poste || null,
        switch_cftv: reg.switch_cftv || null,
        status_switch: reg.status_switch || null,
        onu: reg.onu || null,
        radio_ap: reg.radio_ap || null,
        switch_ap: reg.switch_ap || null,
        status_switch_ap: reg.status_switch_ap || null,
        caixa_padrao: reg.caixa_padrao || null,
        status_padrao: reg.status_padrao || null,
        registro_enel: reg.registro_enel || null,
        lpr01: reg.lpr01 || null,
        lpr01_sentido: reg.lpr01_sentido || null,
        lpr02: reg.lpr02 || null,
        lpr02_sentido: reg.lpr02_sentido || null,
        lpr03: reg.lpr03 || null,
        lpr03_sentido: reg.lpr03_sentido || null,
        lpr04: reg.lpr04 || null,
        lpr04_sentido: reg.lpr04_sentido || null,
        ajuste_lpr: reg.ajuste_lpr || null,
        tombo_cpu: reg.tombo_cpu || null,
        tombo_bullet: reg.tombo_bullet || null,
        tombo_switch_cvm: reg.tombo_switch_cvm || null,
        switch_ligado: reg.switch_ligado || null,
        ajuste_bullet: reg.ajuste_bullet || null
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
