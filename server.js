// CONTROL PREVENTIVA-CE — Servidor unificado
// - Serve PWA (index.html) e NOC (noc.html)
// - API REST: /api/posicao (autenticada), /api/status, /api/playback, /api/equipes
// - WebSocket: bootstrap + position + replay
// - Estado em RAM + persistencia JSONL diaria em data/posicoes/

const path = require('path');
const http = require('http');
const fs = require('fs');
const express = require('express');
const WebSocket = require('ws');
const webPush = require('web-push');

const { EquipesStore, authMiddleware } = require('./auth');
const { PosicoesStore, todayStr }      = require('./posicoes-store');
const { ProducaoStore }                = require('./producao-store');
const { login: authLogin, validaToken, logout: authLogout, authMiddlewareNoc, authMiddlewarePerfil, listarUsuarios, criarUsuario, atualizarUsuario, removerUsuario } = require('./usuarios');

// ============================================================================
// Pontos planejados — carrega para identificar ponto por GPS
// ============================================================================
let pontosPlanejados = [];

// Normaliza lat/lng: detecta a escala (1e3..1e15) e corrige o sinal.
// O JSON original tem escalas mistas (1e5, 1e6, 1e8, 1e15) e as vezes
// sinal trocado. Aqui centralizamos a logica do V3.
const NORM_K_ORDEM = [6, 5, 15, 7, 8, 3, 4, 9, 10, 11, 12, 13, 14];
function normalizarCoordPar(latRaw, lngRaw) {
  const toN = (v) => { if (v == null || v === '') return null; const d = Number(v); return Number.isFinite(d) ? d : null; };
  const lat = toN(latRaw), lng = toN(lngRaw);
  if (lat === null || lng === null) return null;
  const aLat = Math.abs(lat), aLng = Math.abs(lng);
  if (aLat < 100 && aLng < 100) {
    // ja esta em decimal degrees
    let sLat = lat, sLng = lng;
    if (sLat > 0) sLat = -sLat;
    if (sLng > 0) sLng = -sLng;
    return { lat: sLat, lng: sLng };
  }
  // Tenta mesmo k para lat e lng primeiro (caso comum)
  for (const k of NORM_K_ORDEM) {
    const latN = lat / Math.pow(10, k);
    const lngN = lng / Math.pow(10, k);
    if (Math.abs(latN) >= 1 && Math.abs(latN) <= 34 && Math.abs(lngN) >= 30 && Math.abs(lngN) <= 75) {
      let sLat = latN, sLng = lngN;
      if (sLat > 0) sLat = -sLat;
      if (sLng > 0) sLng = -sLng;
      return { lat: sLat, lng: sLng };
    }
  }
  // Tenta k diferentes para lat e lng
  for (const kLat of NORM_K_ORDEM) {
    const latN = lat / Math.pow(10, kLat);
    if (Math.abs(latN) < 1 || Math.abs(latN) > 34) continue;
    for (const kLng of NORM_K_ORDEM) {
      const lngN = lng / Math.pow(10, kLng);
      if (Math.abs(lngN) < 30 || Math.abs(lngN) > 75) continue;
      let sLat = latN, sLng = lngN;
      if (sLat > 0) sLat = -sLat;
      if (sLng > 0) sLng = -sLng;
      return { lat: sLat, lng: sLng };
    }
  }
  return null;
}

function carregarPontosPlanejados() {
  try {
    const filePath = path.join(pwaRoot || __dirname, 'pontos_planejados.json');
    if (!fs.existsSync(filePath)) {
      console.warn('[pontos] pontos_planejados.json nao encontrado em', filePath);
      return;
    }
    let raw = fs.readFileSync(filePath, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // strip BOM
    const data = JSON.parse(raw);
    // Aceita tanto {pontos:[...]} quanto array direto
    const listaBruta = Array.isArray(data) ? data : (Array.isArray(data.pontos) ? data.pontos : []);
    pontosPlanejados = [];
    let semCoord = 0;
    for (const p of listaBruta) {
      const norm = normalizarCoordPar(p.lat, p.lng);
      if (!norm) { semCoord++; continue; }
      pontosPlanejados.push({ ...p, lat: norm.lat, lng: norm.lng });
    }
    console.log(`[pontos] ${pontosPlanejados.length} ponto(s) carregado(s)${semCoord ? ` (${semCoord} sem coordenada normalizavel)` : ''}`);
  } catch (err) {
    console.warn('[pontos] erro ao carregar pontos_planejados.json:', err.message);
  }
}

function distMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function identificarPontoMaisProximo(lat, lng) {
  if (!lat || !lng || !pontosPlanejados.length) return null;

  // Encontra os 2 mais próximos
  let melhor = null, segundo = null;
  let distMelhor = Infinity, distSegundo = Infinity;

  for (const p of pontosPlanejados) {
    if (!p.lat || !p.lng) continue;
    const d = distMetros(lat, lng, p.lat, p.lng);
    if (d < distMelhor) {
      segundo = melhor; distSegundo = distMelhor;
      melhor = p;      distMelhor = d;
    } else if (d < distSegundo) {
      segundo = p; distSegundo = d;
    }
  }

  if (!melhor) return null;

  // Raio dinâmico: metade da distância para o vizinho mais próximo
  // Mínimo 30m, máximo 80m
  const raio = 50; // 50m — GPS em area urbana pode errar 40-50m

  if (distMelhor > raio) return null;
  return { ...melhor, distancia: Math.round(distMelhor), raioUsado: Math.round(raio) };
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 47890;
const HOST = process.env.HOST || (process.env.BEHIND_PROXY === '1' ? '127.0.0.1' : '0.0.0.0');
const NOC_ADMIN_KEY = (process.env.NOC_ADMIN_KEY || '').trim();

function checkAdminKey(req, res) {
  if (!NOC_ADMIN_KEY) return true;
  const key = (req.get('X-Noc-Admin-Key') || '').trim();
  if (!key || key !== NOC_ADMIN_KEY) {
    res.status(401).json({ ok: false, error: 'Admin key invalida' });
    return false;
  }
  return true;
}

app.set('trust proxy', 'loopback');

// ----- Lojas (stores) -----
const equipesStore = new EquipesStore();
const posicoesStore = new PosicoesStore();
const producaoStore = new ProducaoStore();
const requireAuth = authMiddleware(equipesStore);

// ============================================================================
// Push Notifications — Web Push (VAPID)
// ============================================================================
const VAPID_KEYS_FILE = path.join(__dirname, 'data', 'vapid-keys.json');
let vapidKeys;
try {
  vapidKeys = JSON.parse(fs.readFileSync(VAPID_KEYS_FILE, 'utf8'));
} catch (_) {
  console.log('[push] Gerando novas chaves VAPID...');
  vapidKeys = webPush.generateVAPIDKeys();
  try {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
    fs.writeFileSync(VAPID_KEYS_FILE, JSON.stringify(vapidKeys, null, 2), 'utf8');
  } catch (_) { /* fallback — chaves só em RAM */ }
}
const VAPID_CONTACT = process.env.VAPID_CONTACT || 'mailto:admin@preventiva.ce.gov.br';
webPush.setVapidDetails(VAPID_CONTACT, vapidKeys.publicKey, vapidKeys.privateKey);

const SUBSCRIPTIONS_FILE = path.join(__dirname, 'data', 'push-subscriptions.json');
let pushSubscriptions = [];
try {
  if (fs.existsSync(SUBSCRIPTIONS_FILE))
    pushSubscriptions = JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8'));
} catch (_) { /* ignora */ }
if (!Array.isArray(pushSubscriptions)) pushSubscriptions = [];

function saveSubscriptions() {
  try { fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(pushSubscriptions, null, 2), 'utf8'); }
  catch (_) { /* best-effort */ }
}

// ============================================================================
// Mensagens — chat bidirecional NOC <-> Tecnico
// ============================================================================
const MENSAGENS_FILE = path.join(__dirname, 'data', 'mensagens.json');
let mensagens = [];
try {
  if (fs.existsSync(MENSAGENS_FILE))
    mensagens = JSON.parse(fs.readFileSync(MENSAGENS_FILE, 'utf8'));
} catch (_) { /* ignora */ }
if (!Array.isArray(mensagens)) mensagens = [];

function salvarMensagens() {
  try { fs.writeFileSync(MENSAGENS_FILE, JSON.stringify(mensagens, null, 2), 'utf8'); }
  catch (_) { /* best-effort */ }
}

function addMensagem(equipeId, equipeNome, direcao, texto, tipo = 'alerta', arquivoUrl = null, arquivoTipo = null) {
  const msg = {
    id: 'msg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    equipeId,
    equipeNome,
    direcao, // 'noc' | 'tecnico'
    texto: String(texto || '').trim(),
    tipo, // 'alerta' | 'resposta' | 'predefinida' | 'imagem' | 'video'
    arquivoUrl,
    arquivoTipo, // 'image' | 'video' | null
    createdAt: Date.now(),
    lida: false
  };
  mensagens.push(msg);
  salvarMensagens();
  broadcast({ type: 'mensagem', data: msg });

  // Push automatico: NOC -> tecnico. Tecnico -> NOC nao dispara push
  // (NOC usa o painel noc.html com WebSocket; se virar PWA tbm, dah pra
  // adicionar subscribe "noc" no futuro).
  if (direcao === 'noc' && pushSubscriptions.some(s => s.equipeId === equipeId)) {
    const isRapida = tipo === 'predefinida';
    const preview = String(texto || '').slice(0, 100);
    const payload = {
      title: (isRapida ? '⚡ ' : '💬 ') + (equipeNome || equipeId),
      body: preview,
      tag: 'chat-' + equipeId,
      renotify: true,
      vibrate: isRapida ? [100, 50, 100] : [200, 100, 200],
      data: {
        url: './index.html',
        equipeId,
        tipo
      }
    };
    sendPushToSubscriptions(payload, equipeId).catch(err =>
      console.warn('[push] auto-msg noc->tecnico failed:', err.message)
    );
  }

  return msg;
}

async function sendPushToSubscriptions(payload, equipeFilter = null) {
  const results = { sent: 0, failed: 0 };
  for (const sub of pushSubscriptions) {
    if (equipeFilter && sub.equipeId !== equipeFilter) continue;
    // Adiciona token da equipe no payload para o SW poder responder
    const equipe = equipesStore.get(sub.equipeId);
    const token = equipe ? equipe.token : null;
    const enrichedPayload = { ...payload };
    if (token) {
      enrichedPayload.data = { ...enrichedPayload.data, teamToken: token };
    }
    try {
      await webPush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify(enrichedPayload),
        { TTL: 86400 }
      );
      results.sent++;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Subscription expirou — remove
        pushSubscriptions = pushSubscriptions.filter(s => s.endpoint !== sub.endpoint);
        saveSubscriptions();
      }
      results.failed++;
    }
  }
  return results;
}

// ----- Paths estaticos -----
// server.js pode estar na raiz ou em servidor_windows/
// Detecta automaticamente o path correto
const pwaRoot = fs.existsSync(path.join(__dirname, 'rastreamento_noc'))
  ? __dirname
  : path.join(__dirname, '..');
const nocRoot = path.join(pwaRoot, 'rastreamento_noc', 'public');
const producaoDir = path.join(pwaRoot, 'data', 'producao');
const producaoEquipesDir = path.join(pwaRoot, 'data', 'producao_equipes');
fs.mkdirSync(producaoDir, { recursive: true });
fs.mkdirSync(producaoEquipesDir, { recursive: true });

// Carrega pontos visitados hoje do Supabase (async, no boot)
producaoStore.loadPontosVisitadosHoje();

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

async function writeEquipeDiaArquivos(reg) {
  const data = todayStr(new Date(reg.ts || Date.now()));
  const equipeDir = path.join(producaoEquipesDir, safeName(reg.equipeId));
  fs.mkdirSync(equipeDir, { recursive: true });

  const todosDia = (await producaoStore.readDay(data)).filter(r => String(r.equipeId || '').toUpperCase() === String(reg.equipeId || '').toUpperCase());

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

// ===== Upload de arquivos (fotos/videos do chat) =====
const UPLOADS_DIR = path.join(__dirname, 'data', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const multer = require('multer');
const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});
app.use('/uploads', express.static(UPLOADS_DIR));
app.post('/api/upload', upload.single('arquivo'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'Nenhum arquivo enviado' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  const novoNome = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6) + ext;
  const dest = path.join(UPLOADS_DIR, novoNome);
  try {
    fs.renameSync(req.file.path, dest);
  } catch (_) {
    fs.copyFileSync(req.file.path, dest);
    fs.unlinkSync(req.file.path);
  }
  const mime = req.file.mimetype;
  const arquivoTipo = mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : 'file';
  res.json({ ok: true, url: '/uploads/' + novoNome, arquivoTipo });
});

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

// ============================================================================
// Rota dedicada para servir pontos_planejados.json no formato que
// o noc.html espera ({pontos: [...]}), com lat/lng ja normalizados.
// IMPORTANTE: vem ANTES do express.static para interceptar a URL.
// ============================================================================
app.get('/pontos_planejados.json', (_req, res) => {
  try {
    const filePath = path.join(pwaRoot || __dirname, 'pontos_planejados.json');
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ ok: false, error: 'pontos_planejados.json nao encontrado' });
    }
    let raw = fs.readFileSync(filePath, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // strip BOM
    const data = JSON.parse(raw);
    const listaBruta = Array.isArray(data) ? data : (Array.isArray(data.pontos) ? data.pontos : []);
    const pontos = listaBruta.map(p => {
      const norm = normalizarCoordPar(p.lat, p.lng);
      return {
        ...p,
        lat: norm ? norm.lat : p.lat,
        lng: norm ? norm.lng : p.lng
      };
    });
    res.json({ ok: true, total: pontos.length, pontos });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

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
  broadcast({ type: 'position', data: registro });
  res.json({ ok: true });
});

/** Recebe producao do app (coleta de ponto) para auditoria NOC. */
app.post('/api/producao', requireAuth, async (req, res) => {
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

  // Identifica automaticamente o ponto planejado mais próximo pelo GPS
  const pontoIdentificado = identificarPontoMaisProximo(reg.lat, reg.lng);
  if (pontoIdentificado) {
    reg.pontoId       = pontoIdentificado.id;
    reg.pontoNome     = pontoIdentificado.nome;
    reg.pontoCidade   = pontoIdentificado.cidade;
    reg.pontoDistM    = pontoIdentificado.distancia;
    console.log(`[producao] ${reg.equipeId} → ponto #${pontoIdentificado.id} "${pontoIdentificado.nome}" (${pontoIdentificado.distancia}m, raio=${pontoIdentificado.raioUsado}m)`);
  } else {
    console.log(`[producao] ${reg.equipeId} → nenhum ponto próximo (lat:${reg.lat}, lng:${reg.lng})`);
  }

  await producaoStore.append(reg);
  writeEquipeDiaArquivos(reg).catch(err => console.warn('[producao] erro ao gerar arquivos:', err.message));
  broadcast({ type: 'production', data: reg });
  res.json({ ok: true, pontoIdentificado: pontoIdentificado || null });
});

/** Lista producao do dia para painel NOC. */
app.get('/api/producao', async (req, res) => {
  const data = (req.query.data || todayStr()).toString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return res.status(400).json({ ok: false, error: 'Parametro data invalido (YYYY-MM-DD)' });
  }
  const rows = await producaoStore.readDay(data);
  res.json({ ok: true, data, total: rows.length, rows });
});

/** Atualiza um registro de producao (NOC admin). */
app.put('/api/producao/:id', authMiddlewareNoc, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: 'ID invalido' });
  const { pontoNumero, pontoNome, cidade, ais } = req.body || {};
  const changes = {};
  if (pontoNumero !== undefined) changes.ponto_numero = String(pontoNumero).trim();
  if (pontoNome !== undefined) changes.ponto_nome = String(pontoNome).trim();
  if (cidade !== undefined) changes.cidade = String(cidade).trim();
  if (ais !== undefined) changes.ais = String(ais).trim();
  if (Object.keys(changes).length === 0) return res.status(400).json({ ok: false, error: 'Nenhum campo para atualizar' });
  const ok = await producaoStore.update(id, changes);
  res.json({ ok });
});

/**
 * Validacao de token sem efeitos colaterais.
 * Retorna 200 com { equipeId, nome } se token bate, 401 se nao.
 * NAO grava nada no JSONL, NAO faz broadcast WS.
 */
app.get('/api/whoami', requireAuth, (req, res) => {
  res.json({ ok: true, equipe: req.equipe });
});

/**
 * Heartbeat do tecnico em campo.
 * Nao persiste nada — apenas broadcast WS para o NOC saber que a equipe esta ativa.
 */
app.post('/api/heartbeat', requireAuth, (req, res) => {
  const { lat, lng, ts } = req.body || {};
  broadcast({
    type: 'heartbeat',
    data: {
      equipeId: req.equipe.equipeId,
      nome: req.equipe.nome,
      lat: lat || null,
      lng: lng || null,
      ts: Number(ts) || Date.now()
    }
  });
  res.json({ ok: true });
});

/**
 * Registro de atividade do tecnico (inicio de coleta, pausa, etc.) para auditoria NOC.
 */
app.post('/api/atividade', requireAuth, (req, res) => {
  const { tipo, pontoNumero, mensagem } = req.body || {};
  broadcast({
    type: 'atividade',
    data: {
      equipeId: req.equipe.equipeId,
      nome: req.equipe.nome,
      tipo: String(tipo || 'evento').trim(),
      pontoNumero: pontoNumero ? String(pontoNumero).trim() : null,
      mensagem: String(mensagem || '').trim(),
      ts: Date.now()
    }
  });
  res.json({ ok: true });
});

/** Logout de equipe — notifica NOC e remove do snapshot */
app.post('/api/equipe/logout', requireAuth, (req, res) => {
  const data = {
    equipeId: req.equipe.equipeId,
    equipeNome: req.equipe.nome,
    ts: Date.now()
  };
  posicoesStore.remove(req.equipe.equipeId);
  broadcast({ type: 'team-logout', data });
  res.json({ ok: true });
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

// ============================================================================
// Autenticacao do NOC (usuarios)
// ============================================================================
app.post('/api/auth/login', (req, res) => {
  const { usuario, senha } = req.body || {};
  if (!usuario || !senha) return res.status(400).json({ ok: false, error: 'usuario e senha obrigatorios' });
  const token = authLogin(String(usuario).trim(), String(senha));
  if (!token) return res.status(401).json({ ok: false, error: 'usuario ou senha invalidos' });
  const sessao = validaToken(token);
  res.json({ ok: true, token, perfil: sessao.perfil, nome: sessao.nome });
});

app.get('/api/auth/me', authMiddlewareNoc, (req, res) => {
  res.json({ ok: true, usuario: req.usuarioSessao });
});

app.post('/api/auth/logout', authMiddlewareNoc, (req, res) => {
  const token = req.get('X-Noc-Token');
  if (token) authLogout(token);
  res.json({ ok: true });
});

/** Admin: lista usuarios (sem senhas). */
app.get('/api/auth/usuarios', authMiddlewareNoc, authMiddlewarePerfil('admin'), (req, res) => {
  res.json({ ok: true, usuarios: listarUsuarios(), envBased: require('./usuarios').isEnvBased() });
});

/** Admin: cria usuario. */
app.post('/api/auth/usuarios', authMiddlewareNoc, authMiddlewarePerfil('admin'), (req, res) => {
  const { usuario, senha, perfil, nome } = req.body || {};
  try {
    const criado = criarUsuario(usuario, senha, perfil || 'operador', nome);
    res.status(201).json({ ok: true, usuario: criado });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/** Admin: atualiza usuario (senha, perfil, nome). */
app.patch('/api/auth/usuarios/:usuario', authMiddlewareNoc, authMiddlewarePerfil('admin'), (req, res) => {
  try {
    const atualizado = atualizarUsuario(req.params.usuario, req.body || {});
    res.json({ ok: true, usuario: atualizado });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/** Admin: remove usuario. */
app.delete('/api/auth/usuarios/:usuario', authMiddlewareNoc, authMiddlewarePerfil('admin'), (req, res) => {
  try {
    const removido = removerUsuario(req.params.usuario);
    res.json({ ok: true, usuario: removido });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/** Cria equipe + token (uso NOC). Exige X-Noc-Admin-Key ou sessao admin. */
app.post('/api/equipes', (req, res) => {
  if (!checkAdminKey(req, res)) {
    // Fallback: tenta autenticacao por sessao
    const token = req.get('X-Noc-Token');
    const sessao = token ? validaToken(token) : null;
    if (!sessao || sessao.perfil !== 'admin') return;
  }

  const { equipeId, nome, ativo = true } = req.body || {};
  try {
    const criada = equipesStore.createEquipe({ equipeId, nome, ativo });
    res.status(201).json({
      ok: true,
      equipe: {
        equipeId: criada.equipeId,
        nome: criada.nome,
        ativo: criada.ativo,
        token: criada.token
      }
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/** Regenera token de uma equipe existente. */
app.post('/api/equipes/:equipeId/regenerar-token', (req, res) => {
  if (!checkAdminKey(req, res)) {
    const token = req.get('X-Noc-Token');
    const sessao = token ? validaToken(token) : null;
    if (!sessao || sessao.perfil !== 'admin') return;
  }
  try {
    const equipe = equipesStore.regenerateToken(req.params.equipeId);
    res.json({ ok: true, equipe });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/** Ativa/desativa equipe. Body: { ativo: true|false } */
app.patch('/api/equipes/:equipeId/ativo', (req, res) => {
  if (!checkAdminKey(req, res)) {
    const token = req.get('X-Noc-Token');
    const sessao = token ? validaToken(token) : null;
    if (!sessao || sessao.perfil !== 'admin') return;
  }
  const ativo = !!(req.body && req.body.ativo);
  try {
    const equipe = equipesStore.setEquipeAtiva(req.params.equipeId, ativo);
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

/** Identifica o ponto planejado mais próximo e se ja foi visitado hoje. */
app.get('/api/ponto-proximo', (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ ok: false, error: 'lat/lng numericos obrigatorios' });
  }
  const ponto = identificarPontoMaisProximo(lat, lng);
  if (!ponto) return res.json({ ok: true, ponto: null });
  const hoje = todayStr();
  const jaFeito = producaoStore.pontosVisitadosHoje.has(`${hoje}:${ponto.id}`);
  res.json({ ok: true, ponto: { id: ponto.id, nome: ponto.nome, cidade: ponto.cidade, lat: ponto.lat, lng: ponto.lng, distancia: ponto.distancia, jaFeito } });
});

// ============================================================================
// Push Notifications API
// ============================================================================

/** Retorna a chave publica VAPID para o cliente assinar push. */
app.get('/api/push/vapid-key', (_req, res) => {
  res.json({ ok: true, publicKey: vapidKeys.publicKey });
});

/**
 * Salva assinatura push de um dispositivo.
 * Requer autenticacao da equipe.
 */
app.post('/api/push/subscribe', requireAuth, (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ ok: false, error: 'subscription invalida' });
  }
  // Remove assinatura antiga do mesmo equipante (se houver)
  pushSubscriptions = pushSubscriptions.filter(s =>
    s.equipeId !== req.equipe.equipeId || s.endpoint !== endpoint
  );
  pushSubscriptions.push({
    equipeId: req.equipe.equipeId,
    equipeNome: req.equipe.nome,
    endpoint,
    keys,
    userAgent: req.get('User-Agent') || '',
    createdAt: Date.now()
  });
  saveSubscriptions();
  console.log(`[push] ${req.equipe.equipeId} inscrito (total: ${pushSubscriptions.length})`);
  res.json({ ok: true, total: pushSubscriptions.length });
});

/** Remove assinatura push. */
app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ ok: false, error: 'endpoint obrigatorio' });
  pushSubscriptions = pushSubscriptions.filter(s => s.endpoint !== endpoint);
  saveSubscriptions();
  res.json({ ok: true });
});

/**
 * Envia notificacao push para equipes.
 * Exige X-Noc-Admin-Key.
 * Body: { title, body, equipeId?, url?, data? }
 */
app.post('/api/push/notify', (req, res) => {
  const { title = 'Preventiva-CE', body = '', equipeId = null, url = null, data = {} } = req.body || {};
  if (!pushSubscriptions.length) {
    return res.status(200).json({ ok: true, sent: 0, total: 0, msg: 'Nenhuma inscricao ativa' });
  }

  const payload = {
    title: String(title).trim(),
    body: String(body).trim(),
    data: { url, ...data }
  };

  sendPushToSubscriptions(payload, equipeId || null)
    .then(results => {
      // Salva mensagem automaticamente
      const msgBody = String(body).trim();
      if (msgBody) {
        const equipesAlvo = equipeId
          ? [equipesStore.get(equipeId)].filter(Boolean)
          : equipesStore.list();
        for (const eq of equipesAlvo) {
          addMensagem(eq.equipeId, eq.nome || eq.equipeId, 'noc', msgBody, 'alerta');
        }
      }
      res.json({
        ok: true,
        sent: results.sent,
        failed: results.failed,
        total: pushSubscriptions.length,
        filter: equipeId || 'todas'
      });
    })
    .catch(err => {
      res.status(500).json({ ok: false, error: err.message });
    });
});

/** Lista inscricoes ativas. */
app.get('/api/push/subscriptions', (req, res) => {
  const lista = pushSubscriptions.map(s => ({
    equipeId: s.equipeId,
    equipeNome: s.equipeNome,
    userAgent: s.userAgent,
    createdAt: s.createdAt
  }));
  res.json({ ok: true, total: lista.length, subscriptions: lista });
});

// ============================================================================
// Mensagens — chat bidirecional
// ============================================================================

/** Adiciona mensagem (NOC ou tecnico). */
app.post('/api/mensagens', requireAuth, (req, res) => {
  const { texto = '', tipo = 'resposta', equipeId: bodyEquipeId, arquivoUrl, arquivoTipo } = req.body || {};
  const equipe = req.equipe; // de requireAuth
  if (!texto.trim() && !arquivoUrl) return res.status(400).json({ ok: false, error: 'Texto ou arquivo obrigatorio' });
  const msg = addMensagem(equipe.equipeId, equipe.equipeNome || equipe.equipeId, 'tecnico', texto, tipo, arquivoUrl, arquivoTipo);
  res.status(201).json({ ok: true, mensagem: msg });
});

/** Adiciona mensagem do NOC (sem token de equipe). */
app.post('/api/mensagens/noc', (req, res) => {
  const { equipeId, texto = '', tipo = 'alerta', arquivoUrl, arquivoTipo } = req.body || {};
  if (!equipeId) return res.status(400).json({ ok: false, error: 'equipeId obrigatorio' });
  if (!texto.trim() && !arquivoUrl) return res.status(400).json({ ok: false, error: 'Texto ou arquivo obrigatorio' });
  const equipe = equipesStore.get(equipeId);
  const nome = equipe ? (equipe.nome || equipeId) : equipeId;
  const msg = addMensagem(equipeId, nome, 'noc', texto, tipo, arquivoUrl, arquivoTipo);
  res.status(201).json({ ok: true, mensagem: msg });
});

/** Lista mensagens (NOC — todas). */
app.get('/api/mensagens', (_req, res) => {
  res.json({ ok: true, total: mensagens.length, mensagens });
});

/** Lista mensagens de uma equipe. */
app.get('/api/mensagens/:equipeId', requireAuth, (req, res) => {
  const equipe = req.equipe;
  const reqEquipeId = req.params.equipeId;
  if (equipe.equipeId !== reqEquipeId) return res.status(403).json({ ok: false, error: 'Acesso negado' });
  const lista = mensagens.filter(m => m.equipeId === reqEquipeId);
  res.json({ ok: true, total: lista.length, mensagens: lista });
});

/** Marca mensagem como lida. */
app.patch('/api/mensagens/:id/lida', (_req, res) => {
  const msg = mensagens.find(m => m.id === _req.params.id);
  if (!msg) return res.status(404).json({ ok: false, error: 'Mensagem nao encontrada' });
  msg.lida = true;
  salvarMensagens();
  res.json({ ok: true });
});

/** Contagem de nao lidas por equipe. */
app.get('/api/mensagens/nao-lidas/contagem', (_req, res) => {
  const naoLidas = {};
  for (const m of mensagens) {
    if (!m.lida) naoLidas[m.equipeId] = (naoLidas[m.equipeId] || 0) + 1;
  }
  res.json({ ok: true, naoLidas });
});

// ============================================================================
// Paginas
// ============================================================================
app.get('/noc',     (_req, res) => res.sendFile(path.join(nocRoot, 'noc.html')));
app.get('/tracker', (_req, res) => res.sendFile(path.join(nocRoot, 'tracker.html')));

// Ruas de Fortaleza — GeoJSON comprimido (gzip)
app.get('/fortaleza_roads.geojson.gz', (req, res) => {
  const filePath = path.join(nocRoot, 'fortaleza_roads.geojson.gz');
  res.setHeader('Content-Encoding', 'gzip');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // cache 1 dia
  res.sendFile(filePath, (err) => {
    if (err) {
      console.warn('[roads] Arquivo nao encontrado:', filePath);
      res.status(404).json({ error: 'fortaleza_roads.geojson.gz nao encontrado' });
    }
  });
});

// Fallback — GeoJSON sem compressao
app.get('/fortaleza_roads.geojson', (req, res) => {
  const filePath = path.join(nocRoot, 'fortaleza_roads.geojson');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filePath, (err) => {
    if (err) res.status(404).json({ error: 'fortaleza_roads.geojson nao encontrado' });
  });
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
// Carrega pontos planejados (precisa de pwaRoot definido)
carregarPontosPlanejados();

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
