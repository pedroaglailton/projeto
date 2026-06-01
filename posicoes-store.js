// Persistencia append-only de posicoes GPS em arquivos JSONL diarios.
// - 1 arquivo por dia: data/posicoes/YYYY-MM-DD.jsonl
// - WriteStream com flag 'a' (append) — sobrevive a queda do processo
// - Rotacao automatica a meia-noite
// - Leitura streaming para playback (nunca carrega tudo na memoria)
// - Mantem ultimo snapshot por equipe (estado atual em memoria) para bootstrap rapido do NOC

const fs   = require('fs');
const path = require('path');
const readline = require('readline');

const POSICOES_DIR = path.join(__dirname, 'data', 'posicoes');

function todayStr(d = new Date()) {
  // YYYY-MM-DD em horario local
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

class PosicoesStore {
  constructor(dir = POSICOES_DIR) {
    this.dir = dir;
    this.currentDate = todayStr();
    this.stream = null;
    this.snapshot = new Map();   // equipeId -> ultima posicao (estado atual)
    fs.mkdirSync(dir, { recursive: true });
    this._openStream();
    this._scheduleRotate();
    this._loadTodaySnapshot();
  }

  _filePath(dateStr = this.currentDate) {
    return path.join(this.dir, `${dateStr}.jsonl`);
  }

  _openStream() {
    if (this.stream) {
      try { this.stream.end(); } catch (_) {}
    }
    this.stream = fs.createWriteStream(this._filePath(), { flags: 'a', encoding: 'utf8' });
    this.stream.on('error', err => console.error('[posicoes] erro no stream:', err));
  }

  _scheduleRotate() {
    // Calcula ms ate a proxima meia-noite local + 1s de margem
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1, 0);
    const ms = next.getTime() - now.getTime();
    setTimeout(() => {
      const novaData = todayStr();
      if (novaData !== this.currentDate) {
        console.log(`[posicoes] rotacionando ${this.currentDate} -> ${novaData}`);
        this.currentDate = novaData;
        this._openStream();
      }
      this._scheduleRotate();
    }, Math.max(ms, 1000));
  }

  /**
   * Carrega ultima posicao de cada equipe a partir do arquivo de hoje.
   * Usado no boot para que o NOC ja receba o snapshot atual.
   */
  _loadTodaySnapshot() {
    const file = this._filePath();
    if (!fs.existsSync(file)) return;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const linhas = raw.split('\n').filter(l => l.trim());
      for (const linha of linhas) {
        try {
          const reg = JSON.parse(linha);
          if (reg && reg.equipeId) this.snapshot.set(reg.equipeId, reg);
        } catch (_) {}
      }
      console.log(`[posicoes] snapshot inicial: ${this.snapshot.size} equipe(s)`);
    } catch (err) {
      console.warn('[posicoes] erro ao carregar snapshot:', err.message);
    }
  }

  /**
   * Grava uma posicao no JSONL do dia e atualiza o snapshot em memoria.
   * @param {object} reg  {equipeId, equipeNome, lat, lng, speed, heading, accuracy, ts}
   */
  append(reg) {
    // Rotacao defensiva: se o dia mudou desde a ultima checagem (timer falhou?)
    const hoje = todayStr();
    if (hoje !== this.currentDate) {
      this.currentDate = hoje;
      this._openStream();
    }
    const linha = JSON.stringify(reg) + '\n';
    this.stream.write(linha);
    this.snapshot.set(reg.equipeId, reg);
  }

  /** Retorna o estado atual de todas as equipes (para bootstrap WS). */
  current() {
    return Array.from(this.snapshot.values());
  }

  /**
   * Le todas as posicoes de um dia em ordem cronologica.
   * Streaming linha-a-linha — funciona com arquivos grandes.
   * @param {string} dateStr YYYY-MM-DD
   * @param {string} [equipeId] filtro opcional
   * @returns {Promise<Array>}
   */
  async readDay(dateStr, equipeId = null) {
    const file = this._filePath(dateStr);
    if (!fs.existsSync(file)) return [];
    const equipeFiltro = equipeId ? String(equipeId).toUpperCase() : null;

    const rl = readline.createInterface({
      input: fs.createReadStream(file, { encoding: 'utf8' }),
      crlfDelay: Infinity
    });

    const out = [];
    for await (const linha of rl) {
      if (!linha.trim()) continue;
      try {
        const reg = JSON.parse(linha);
        if (equipeFiltro && String(reg.equipeId).toUpperCase() !== equipeFiltro) continue;
        out.push(reg);
      } catch (_) {
        // linha corrompida — ignora
      }
    }
    // Garante ordem cronologica (deveria ja estar)
    out.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return out;
  }

  /** Lista de datas com arquivo gravado, mais recentes primeiro. */
  listDates() {
    try {
      return fs.readdirSync(this.dir)
        .filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
        .map(f => f.replace('.jsonl', ''))
        .sort()
        .reverse();
    } catch (_) {
      return [];
    }
  }

  close() {
    if (this.stream) {
      try { this.stream.end(); } catch (_) {}
    }
  }
}

module.exports = { PosicoesStore, todayStr };
