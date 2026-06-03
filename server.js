// CAMCONTROL PREVENTIVA-CE — Servidor unificado
// - Serve PWA (index.html) e NOC (noc.html)
// - API REST: /api/posicao (autenticada), /api/status, /api/playback, /api/equipes
// - WebSocket: bootstrap + position + replay
// - Estado em RAM + persistencia JSONL diaria em data/posicoes/

const path = require('path');
const http = require('http');
const fs = require('fs');
const express = require('express');
const WebSocket = require('ws');

const { EquipesStore, authMiddleware } = require('./auth');
const { PosicoesStore, todayStr }      = require('./posicoes-store');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 47890;
const HOST = process.env.HOST || (process.env.BEHIND_PROXY === '1' ? '127.0.0.1' : '0.0.0.0');
const NOC_ADMIN_KEY = (process.env.NOC_ADMIN_KEY || '').trim();
const GITHUB_TOKEN = (process.env.GITHUB_TOKEN || '').trim();
const GITHUB_OWNER = (process.env.GITHUB_OWNER || '').trim();
const GITHUB_REPO = (process.env.GITHUB_REPO || '').trim();
const GITHUB_BRANCH = (process.env.GITHUB_BRANCH || 'main').trim();
const GITHUB_SYNC_HISTORY = (process.env.GITHUB_SYNC_HISTORY || '1').trim() === '1';
const EQUIPES_FILE_ABS = path.join(__dirname, 'data', 'equipes.json');
const syncTimers = new Map();

function checkAdminKey(req, res) {
  if (!NOC_ADMIN_KEY) return true;
  const key = (req.get('X-Noc-Admin-Key') || '').trim();
  if (!key || key !== NOC_ADMIN_KEY) {
    res.status(401).json({ ok: false, error: 'Admin key invalida' });
    return false;
  }
  return true;
}

async function syncEquipesJsonToGitHub(reason = 'update equipes via NOC') {
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return { ok: false, skipped: true, reason: 'github env vars ausentes' };
  }

  const filePath = 'data/equipes.json';
  const contentRaw = fs.readFileSync(EQUIPES_FILE_ABS, 'utf8');
  const encoded = Buffer.from(contentRaw, 'utf8').toString('base64');
  const headers = {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'preventiva-render-sync'
  };

  let sha = null;
  const getUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
  try {
    const rGet = await fetch(getUrl, { headers });
    if (rGet.ok) {
      const j = await rGet.json();
      sha = j.sha || null;
    }
  } catch (_) {}

  const putUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
  const payload = {
    message: reason,
    content: encoded,
    branch: GITHUB_BRANCH,
    sha: sha || undefined
  };

  const rPut = await fetch(putUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!rPut.ok) {
    const txt = await rPut.text();
    throw new Error(`GitHub sync falhou (${rPut.status}): ${txt}`);
  }
  return { ok: true };
}

async function syncLocalFileToGitHub(relativePath, reason = 'sync file') {
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return { ok: false, skipped: true, reason: 'github env vars ausentes' };
  }

  const absPath = path.join(__dirname, relativePath);
  if (!fs.existsSync(absPath)) return { ok: false, skipped: true, reason: 'arquivo nao existe' };

  const contentRaw = fs.readFileSync(absPath, 'utf8');
  const encoded = Buffer.from(contentRaw, 'utf8').toString('base64');
  const headers = {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'preventiva-render-sync'
  };

  let sha = null;
  const getUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${relativePath}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
  try {
    const rGet = await fetch(getUrl, { headers });
    if (rGet.ok) {
      const j = await rGet.json();
      sha = j.sha || null;
    }
  } catch (_) {}

  const putUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${relativePath}`;
  const payload = {
    message: reason,
    content: encoded,
    branch: GITHUB_BRANCH,
    sha: sha || undefined
  };

  const rPut = await fetch(putUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!rPut.ok) {
    const txt = await rPut.text();
    throw new Error(`GitHub sync falhou (${rPut.status}) ${relativePath}: ${txt}`);
  }
  return { ok: true };
}

function scheduleGitHubFileSync(relativePath, reason, delayMs = 60000) {
  if (!GITHUB_SYNC_HISTORY) return;
  const old = syncTimers.get(relativePath);
  if (old) clearTimeout(old);
  const t = setTimeout(async () => {
    try {
      await syncLocalFileToGitHub(relativePath, reason);
      console.log(`[github] sync OK ${relativePath}`);
    } catch (err) {
      console.warn('[github] sync falhou:', err.message);
    } finally {
      syncTimers.delete(relativePath);
    }
  }, Math.max(5000, delayMs));
  syncTimers.set(relativePath, t);
}

app.set('trust proxy', 'loopback');

// ----- Lojas (stores) -----
const equipesStore = new EquipesStore();
const posicoesStore = new PosicoesStore();
const requireAuth = authMiddleware(equipesStore);

// ----- Paths estaticos -----
const pwaRoot = path.join(__dirname);
const nocRoot = path.join(__dirname, 'rastreamento_noc', 'public');
const producaoDir = path.join(__dirname, 'data', 'producao');
const producaoEquipesDir = path.join(__dirname, 'data', 'producao_equipes');
fs.mkdirSync(producaoDir, { recursive: true });
fs.mkdirSync(producaoEquipesDir, { recursive: true });

const producaoSnapshot = new Map();
function producaoFile(data = todayStr()) { return path.join(producaoDir, `${data}.jsonl`); }
function appendProducao(reg) {
  const data = todayStr(new Date(reg.ts || Date.now()));
  fs.appendFileSync(producaoFile(data), JSON.stringify(reg) + '\n', 'utf8');
  const key = `${data}:${reg.equipeId}:${reg.pontoNumero || 'SEM-PONTO'}`;
  producaoSnapshot.set(key, reg);
}
function readProducao(data) {
  const file = producaoFile(data);
  if (!fs.existsSync(file)) return [];
  const linhas = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const out = [];
  for (const ln of linhas) {
    try { out.push(JSON.parse(ln)); } catch (_) {}
  }
  out.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return out;
}

function safeName(v) {
  return String(v || 'SEM_EQUIPE').trim().replace(/[\\/:*?"<>|\s]+/g, '_').toUpperCase();
}

function escXml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function writeEquipeDiaArquivos(reg) {
  const data = todayStr(new Date(reg.ts || Date.now()));
  const equipeDir = path.join(producaoEquipesDir, safeName(reg.equipeId));
  fs.mkdirSync(equipeDir, { recursive: true });

  const todosDia = readProducao(data).filter(r => String(r.equipeId || '').toUpperCase() === String(reg.equipeId || '').toUpperCase());

  const txtPath = path.join(equipeDir, `${data}.txt`);
  const linhas = [];
  linhas.push(`PRODUCAO DIARIA - ${reg.equipeNome || reg.equipeId} - ${data}`);
  linhas.push('');
  for (const r of todosDia) {
    const hora = new Date(r.ts || Date.now()).toLocaleTimeString('pt-BR');
    linhas.push(`HORA: ${hora} | PONTO: ${r.pontoNumero || 'NAO INFORMADO'} | CIDADE: ${r.cidade || 'NAO INFORMADO'} | AIS: ${r.ais || 'NAO INFORMADO'} | LAT: ${r.lat ?? 'NA'} | LNG: ${r.lng ?? 'NA'} | ACC: ${r.accuracy ?? 'NA'}`);
  }
  fs.writeFileSync(txtPath, linhas.join('\n'), 'utf8');

  const xmlPath = path.join(equipeDir, `${data}.xml`);
  const items = todosDia.map(r => {
    const iso = new Date(r.ts || Date.now()).toISOString();
    return [
      '  <registro>',
      `    <equipeId>${escXml(r.equipeId)}</equipeId>`,
      `    <equipeNome>${escXml(r.equipeNome)}</equipeNome>`,
      `    <pontoNumero>${escXml(r.pontoNumero || '')}</pontoNumero>`,
      `    <cidade>${escXml(r.cidade || '')}</cidade>`,
      `    <ais>${escXml(r.ais || '')}</ais>`,
      `    <lat>${escXml(r.lat ?? '')}</lat>`,
      `    <lng>${escXml(r.lng ?? '')}</lng>`,
      `    <accuracy>${escXml(r.accuracy ?? '')}</accuracy>`,
      `    <origem>${escXml(r.origem || 'live')}</origem>`,
      `    <ts>${escXml(r.ts || '')}</ts>`,
      `    <iso>${escXml(iso)}</iso>`,
      '  </registro>'
    ].join('\n');
  }).join('\n');

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<producao data="${escXml(data)}" equipeId="${escXml(reg.equipeId)}" equipeNome="${escXml(reg.equipeNome || reg.equipeId)}">`,
    items,
    '</producao>'
  ].join('\n');
  fs.writeFileSync(xmlPath, xml, 'utf8');
}

app.use(express.json({ limit: '1mb' }));

// ===== CORS =====
// Em deploy split (PWA no Netlify + API noutro host) o navegador faz preflight.
// CORS_ALLOW_ORIGIN aceita:
//   - vazio ou '*'                                -> aceita qualquer origem (dev/teste)
//   - 'https://app.netlify.app'                    -> exato (recomendado em producao)
//   - 'https://a.netlify.app,https://b.app'        -> lista CSV
const CORS_ALLOW = (process.env.CORS_ALLOW_ORIGIN || '*')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  let allow = '*';
  if (CORS_ALLOW.length && CORS_ALLOW[0] !== '*') {
    allow = CORS_ALLOW.includes(origin) ? origin : CORS_ALLOW[0];
  }
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Equipe-Token');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Cache control (PWA bits)
app.get('/sw.js',         (_req, res, next) => { res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); next(); });
app.get('/manifest.json', (_req, res, next) => { res.setHeader('Cache-Control', 'no-cache'); next(); });
app.get('/index.html',    (_req, res, next) => { res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); next(); });

// Arquivos estaticos
app.use(express.static(pwaRoot));
app.use('/noc-static', express.static(nocRoot));

// ----- Broadcast helper -----
function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

// ============================================================================
// API
// ============================================================================

/**
 * Recebe posicao GPS de um tecnico em campo.
 * Header obrigatorio: X-Equipe-Token
 * O equipeId/equipeNome enviados sao IGNORADOS — usamos os do token,
 * para impedir que uma equipe se passe por outra.
 */
app.post('/api/posicao', requireAuth, (req, res) => {
  const { lat, lng, speed = null, heading = null, accuracy = null, ts = Date.now(), pontoNumero = null } = req.body || {};

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ ok: false, error: 'lat/lng invalidos' });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ ok: false, error: 'lat/lng fora do intervalo' });
  }

  const registro = {
    equipeId:   req.equipe.equipeId,   // <- vem do token, nao do payload
    equipeNome: req.equipe.nome,
    pontoNumero: pontoNumero ? String(pontoNumero).trim() : null,
    lat, lng, speed, heading, accuracy,
    ts: Number(ts) || Date.now()
  };

  posicoesStore.append(registro);
  if (GITHUB_SYNC_HISTORY) {
    const d = todayStr(new Date(registro.ts || Date.now()));
    scheduleGitHubFileSync(`data/posicoes/${d}.jsonl`, `sync posicoes ${d}`, 45000);
  }
  broadcast({ type: 'position', data: registro });
  res.json({ ok: true });
});

/** Heartbeat: app online mesmo sem nova coordenada. */
app.post('/api/heartbeat', requireAuth, (req, res) => {
  const body = req.body || {};
  const reg = {
    equipeId: req.equipe.equipeId,
    equipeNome: req.equipe.nome,
    lat: typeof body.lat === 'number' ? body.lat : null,
    lng: typeof body.lng === 'number' ? body.lng : null,
    ts: Number(body.ts) || Date.now(),
    status: 'alive'
  };
  broadcast({ type: 'heartbeat', data: reg });
  res.json({ ok: true });
});

/** Atividade operacional da equipe (coletando/concluido). */
app.post('/api/atividade', requireAuth, (req, res) => {
  const body = req.body || {};
  const reg = {
    equipeId: req.equipe.equipeId,
    equipeNome: req.equipe.nome,
    tipo: String(body.tipo || '').trim() || 'info',
    pontoNumero: body.pontoNumero ? String(body.pontoNumero).trim() : null,
    mensagem: body.mensagem ? String(body.mensagem).trim() : null,
    ts: Number(body.ts) || Date.now()
  };
  broadcast({ type: 'activity', data: reg });
  res.json({ ok: true });
});

/** Recebe producao do app (coleta de ponto) para auditoria NOC. */
app.post('/api/producao', requireAuth, (req, res) => {
  const body = req.body || {};
  const reg = {
    equipeId: req.equipe.equipeId,
    equipeNome: req.equipe.nome,
    pontoNumero: body.pontoNumero ? String(body.pontoNumero).trim() : null,
    cidade: body.cidade ? String(body.cidade).trim() : null,
    ais: body.ais ? String(body.ais).trim() : null,
    lat: typeof body.lat === 'number' ? body.lat : null,
    lng: typeof body.lng === 'number' ? body.lng : null,
    accuracy: typeof body.accuracy === 'number' ? body.accuracy : null,
    ts: Number(body.ts) || Date.now(),
    origem: body.origem === 'offline-queue' ? 'offline-queue' : 'live'
  };
  if (!reg.pontoNumero) return res.status(400).json({ ok: false, error: 'pontoNumero obrigatorio' });
  appendProducao(reg);
  writeEquipeDiaArquivos(reg);
  if (GITHUB_SYNC_HISTORY) {
    const d = todayStr(new Date(reg.ts || Date.now()));
    const equipeSafe = safeName(reg.equipeId);
    scheduleGitHubFileSync(`data/producao/${d}.jsonl`, `sync producao ${d}`, 45000);
    scheduleGitHubFileSync(`data/producao_equipes/${equipeSafe}/${d}.txt`, `sync producao txt ${equipeSafe} ${d}`, 60000);
    scheduleGitHubFileSync(`data/producao_equipes/${equipeSafe}/${d}.xml`, `sync producao xml ${equipeSafe} ${d}`, 60000);
  }
  broadcast({ type: 'production', data: reg });
  res.json({ ok: true });
});

/** Lista producao do dia para painel NOC. */
app.get('/api/producao', (req, res) => {
  const data = (req.query.data || todayStr()).toString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return res.status(400).json({ ok: false, error: 'Parametro data invalido (YYYY-MM-DD)' });
  }
  const rows = readProducao(data);
  res.json({ ok: true, data, total: rows.length, rows });
});

/**
 * Validacao de token sem efeitos colaterais.
 * Retorna 200 com { equipeId, nome } se token bate, 401 se nao.
 * NAO grava nada no JSONL, NAO faz broadcast WS.
 */
app.get('/api/whoami', requireAuth, (req, res) => {
  res.json({ ok: true, equipe: req.equipe });
});

/** Estado atual de todas as equipes (publico — info ja visivel no NOC). */
app.get('/api/status', (_req, res) => {
  const equipes = posicoesStore.current();
  res.json({ ok: true, totalEquipes: equipes.size || equipes.length, equipes });
});

/** Lista de equipes cadastradas (sem tokens). */
app.get('/api/equipes', (_req, res) => {
  res.json({ ok: true, equipes: equipesStore.list() });
});

/** Cria equipe + token (uso NOC). Exige X-Noc-Admin-Key quando NOC_ADMIN_KEY estiver definido. */
app.post('/api/equipes', (req, res) => {
  if (!checkAdminKey(req, res)) return;

  const { equipeId, nome, ativo = true } = req.body || {};
  try {
    const criada = equipesStore.createEquipe({ equipeId, nome, ativo });
    const out = {
      ok: true,
      equipe: {
        equipeId: criada.equipeId,
        nome: criada.nome,
        ativo: criada.ativo,
        token: criada.token
      }
    };
    syncEquipesJsonToGitHub(`add equipe ${criada.equipeId} via NOC`)
      .then(r => { if (r.ok) console.log(`[github] equipes.json sync OK (${criada.equipeId})`); })
      .catch(err => console.warn('[github] sync falhou:', err.message));
    res.status(201).json(out);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/** Regenera token de uma equipe existente. */
app.post('/api/equipes/:equipeId/regenerar-token', (req, res) => {
  if (!checkAdminKey(req, res)) return;
  try {
    const equipe = equipesStore.regenerateToken(req.params.equipeId);
    syncEquipesJsonToGitHub(`regenerate token ${equipe.equipeId} via NOC`)
      .then(r => { if (r.ok) console.log(`[github] equipes.json sync OK (${equipe.equipeId})`); })
      .catch(err => console.warn('[github] sync falhou:', err.message));
    res.json({ ok: true, equipe });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/** Ativa/desativa equipe. Body: { ativo: true|false } */
app.patch('/api/equipes/:equipeId/ativo', (req, res) => {
  if (!checkAdminKey(req, res)) return;
  const ativo = !!(req.body && req.body.ativo);
  try {
    const equipe = equipesStore.setEquipeAtiva(req.params.equipeId, ativo);
    syncEquipesJsonToGitHub(`set ativo=${equipe.ativo} ${equipe.equipeId} via NOC`)
      .then(r => { if (r.ok) console.log(`[github] equipes.json sync OK (${equipe.equipeId})`); })
      .catch(err => console.warn('[github] sync falhou:', err.message));
    res.json({ ok: true, equipe });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/**
 * Playback: posicoes de uma data (default hoje), filtrado por equipe (opcional).
 * GET /api/playback?data=2026-05-25&equipeId=EQUIPE-01
 */
app.get('/api/playback', async (req, res) => {
  const data = (req.query.data || todayStr()).toString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return res.status(400).json({ ok: false, error: 'Parametro data invalido (YYYY-MM-DD)' });
  }
  const equipeId = req.query.equipeId ? String(req.query.equipeId) : null;
  try {
    const posicoes = await posicoesStore.readDay(data, equipeId);
    res.json({ ok: true, data, equipeId, total: posicoes.length, posicoes });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** Lista de datas com dados disponiveis (para o date picker do NOC). */
app.get('/api/playback/datas', (_req, res) => {
  res.json({ ok: true, datas: posicoesStore.listDates() });
});

// ============================================================================
// Paginas
// ============================================================================
app.get('/', (_req, res) => {
  res.type('text/html').send(
    '<!doctype html><html><head><meta charset="utf-8"><title>Preventiva API</title></head><body style="font-family:Arial,sans-serif;padding:24px">' +
    '<h2>CAMCONTROL PREVENTIVA-CE API online</h2>' +
    '<p>Endpoints principais:</p>' +
    '<ul>' +
    '<li><a href="/api/status">/api/status</a></li>' +
    '<li><a href="/noc">/noc</a></li>' +
    '</ul>' +
    '</body></html>'
  );
});
app.get('/noc',     (_req, res) => res.sendFile(path.join(nocRoot, 'noc.html')));
app.get('/tracker', (_req, res) => res.sendFile(path.join(nocRoot, 'tracker.html')));
app.get('/fortaleza_roads.geojson.gz', (_req, res) => {
  res.setHeader('Content-Encoding', 'gzip');
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(path.join(nocRoot, 'fortaleza_roads.geojson.gz'));
});

// ============================================================================
// WebSocket
// ============================================================================
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'bootstrap', data: posicoesStore.current() }));
});

// 404
app.use((_req, res) => res.status(404).type('text/plain').send('Rota nao encontrada'));

// ============================================================================
// Shutdown gracioso
// ============================================================================
function shutdown() {
  console.log('\n[server] desligando...');
  posicoesStore.close();
  equipesStore.close();
  server.close(() => process.exit(0));
  // Hard exit se algo travar
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

// ============================================================================
// Start
// ============================================================================
server.listen(PORT, HOST, () => {
  console.log(`==========================================================`);
  console.log(`CAMCONTROL PREVENTIVA-CE — servidor online`);
  console.log(`==========================================================`);
  console.log(`Endereco:  http://${HOST}:${PORT}`);
  console.log(`PWA:       http://localhost:${PORT}/index.html`);
  console.log(`NOC:       http://localhost:${PORT}/noc`);
  console.log(`Equipes:   ${equipesStore.list().length} cadastrada(s)`);
  console.log(`==========================================================`);
});
