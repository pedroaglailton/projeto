// Autenticacao por equipe via X-Equipe-Token
// - Carrega data/equipes.json no boot
// - Faz hot-reload se o arquivo mudar (fs.watch)
// - Compara token em tempo constante (timingSafeEqual) para evitar timing attacks

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_PATH = path.join(__dirname, 'data', 'equipes.json');

class EquipesStore {
  constructor(filePath = DEFAULT_PATH) {
    this.filePath = filePath;
    this.byId    = new Map();    // equipeId  -> registro
    this.byToken = new Map();    // token     -> registro
    this._watcher = null;
    this._reloadTimer = null;
    this.load();
    this._watch();
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        console.warn(`[auth] ${this.filePath} nao existe. Nenhuma equipe carregada.`);
        this.byId.clear();
        this.byToken.clear();
        return;
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const data = JSON.parse(raw);
      const lista = Array.isArray(data.equipes) ? data.equipes : [];

      const byId = new Map();
      const byToken = new Map();
      for (const e of lista) {
        if (!e.equipeId || !e.token) continue;
        if (e.ativo === false) continue;
        // Sanitiza
        const reg = {
          equipeId: String(e.equipeId).trim().toUpperCase(),
          nome:     String(e.nome || e.equipeId).trim(),
          token:    String(e.token).trim(),
          ativo:    e.ativo !== false
        };
        if (reg.token.length < 16) {
          console.warn(`[auth] token muito curto para ${reg.equipeId} (min 16 chars). Ignorando.`);
          continue;
        }
        byId.set(reg.equipeId, reg);
        byToken.set(reg.token, reg);
      }
      this.byId = byId;
      this.byToken = byToken;
      console.log(`[auth] ${this.byId.size} equipe(s) carregada(s) de ${this.filePath}`);
    } catch (err) {
      console.error(`[auth] erro ao carregar ${this.filePath}:`, err.message);
    }
  }

  _watch() {
    try {
      // fs.watch dispara varias vezes na mesma alteracao em alguns FS — debounce 300ms
      this._watcher = fs.watch(path.dirname(this.filePath), (event, filename) => {
        if (filename && path.basename(this.filePath) === filename) {
          clearTimeout(this._reloadTimer);
          this._reloadTimer = setTimeout(() => {
            console.log('[auth] equipes.json mudou — recarregando...');
            this.load();
          }, 300);
        }
      });
    } catch (err) {
      console.warn('[auth] fs.watch falhou (hot-reload desativado):', err.message);
    }
  }

  /** Constant-time token lookup */
  validate(token) {
    if (!token || typeof token !== 'string') return null;
    // Map.get é O(1) mas vaza tempo — fazemos lookup direto E comparamos
    // com timingSafeEqual em todos os registros para nivelar o custo.
    const tokenBuf = Buffer.from(token);
    let match = null;
    for (const [storedToken, reg] of this.byToken) {
      const storedBuf = Buffer.from(storedToken);
      if (storedBuf.length === tokenBuf.length &&
          crypto.timingSafeEqual(storedBuf, tokenBuf)) {
        match = reg;
        // nao retorna cedo — continua o loop para nao vazar timing
      }
    }
    return match;
  }

  get(equipeId) {
    if (!equipeId) return null;
    const id = String(equipeId).trim().toUpperCase();
    return this.byId.get(id) || null;
  }

  updateNome(equipeId, novoNome) {
    const id = String(equipeId || '').trim().toUpperCase();
    if (!id || !novoNome) return false;
    const data = this._readRawFile();
    const eq = data.equipes.find(e => String(e.equipeId).trim().toUpperCase() === id);
    if (!eq) return false;
    eq.nome = String(novoNome).trim();
    this._writeRawFile(data);
    this.load();
    return true;
  }

  list() {
    return Array.from(this.byId.values()).map(e => ({
      equipeId: e.equipeId,
      nome: e.nome,
      ativo: e.ativo
    }));
  }

  _readRawFile() {
    if (!fs.existsSync(this.filePath)) return { equipes: [] };
    const raw = fs.readFileSync(this.filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.equipes)) data.equipes = [];
    return data;
  }

  _writeRawFile(data) {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  createEquipe({ equipeId, nome, ativo = true }) {
    const id = String(equipeId || '').trim().toUpperCase();
    const nm = String(nome || id).trim();
    if (!id) throw new Error('equipeId obrigatorio');
    if (!/^[A-Z0-9_-]{3,40}$/.test(id)) {
      throw new Error('equipeId invalido (use A-Z, 0-9, _ ou -, 3-40 chars)');
    }

    const data = this._readRawFile();
    const exists = data.equipes.some(e => String(e.equipeId || '').trim().toUpperCase() === id);
    if (exists) throw new Error('equipeId ja existe');

    const token = crypto.randomBytes(32).toString('hex');
    const reg = { equipeId: id, nome: nm, token, ativo: ativo !== false };
    data.equipes.push(reg);
    this._writeRawFile(data);
    this.load();
    return reg;
  }

  regenerateToken(equipeId) {
    const id = String(equipeId || '').trim().toUpperCase();
    if (!id) throw new Error('equipeId obrigatorio');

    const data = this._readRawFile();
    const idx = data.equipes.findIndex(e => String(e.equipeId || '').trim().toUpperCase() === id);
    if (idx < 0) throw new Error('equipeId nao encontrada');

    const token = crypto.randomBytes(32).toString('hex');
    data.equipes[idx].token = token;
    this._writeRawFile(data);
    this.load();

    return {
      equipeId: id,
      nome: String(data.equipes[idx].nome || id).trim(),
      ativo: data.equipes[idx].ativo !== false,
      token
    };
  }

  setEquipeAtiva(equipeId, ativo) {
    const id = String(equipeId || '').trim().toUpperCase();
    if (!id) throw new Error('equipeId obrigatorio');

    const data = this._readRawFile();
    const idx = data.equipes.findIndex(e => String(e.equipeId || '').trim().toUpperCase() === id);
    if (idx < 0) throw new Error('equipeId nao encontrada');

    data.equipes[idx].ativo = ativo !== false;
    this._writeRawFile(data);
    this.load();

    return {
      equipeId: id,
      nome: String(data.equipes[idx].nome || id).trim(),
      ativo: data.equipes[idx].ativo !== false
    };
  }

  close() {
    if (this._watcher) this._watcher.close();
  }
}

/**
 * Middleware Express que exige X-Equipe-Token valido.
 * Anexa req.equipe = { equipeId, nome } se ok.
 */
function authMiddleware(store) {
  return (req, res, next) => {
    const token = req.get('X-Equipe-Token') || req.query.token;
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Token ausente (header X-Equipe-Token)' });
    }
    const equipe = store.validate(token);
    if (!equipe) {
      return res.status(401).json({ ok: false, error: 'Token invalido ou equipe inativa' });
    }
    req.equipe = { equipeId: equipe.equipeId, nome: equipe.nome };
    next();
  };
}

module.exports = { EquipesStore, authMiddleware };
