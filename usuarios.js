const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USUARIOS_FILE = path.join(__dirname, 'data', 'usuarios.json');
const sessoes = new Map(); // token -> { usuario, perfil, nome }

function carregarUsuarios() {
  // Tenta carregar de variavel de ambiente primeiro (Render)
  try {
    const envUsers = process.env.NOC_USERS;
    if (envUsers) {
      const parsed = JSON.parse(envUsers);
      if (Array.isArray(parsed) && parsed.length) {
        console.log(`[usuarios] ${parsed.length} usuario(s) carregado(s) via NOC_USERS env`);
        return parsed;
      }
    }
  } catch (_) { /* fallback */ }

  try {
    if (!fs.existsSync(USUARIOS_FILE)) {
      const defaultUsers = {
        usuarios: [
          { usuario: 'admin', senha: 'admin123', perfil: 'admin', nome: 'Administrador' },
          { usuario: 'operador', senha: 'oper123', perfil: 'operador', nome: 'Operador' }
        ]
      };
      fs.mkdirSync(path.dirname(USUARIOS_FILE), { recursive: true });
      fs.writeFileSync(USUARIOS_FILE, JSON.stringify(defaultUsers, null, 2), 'utf8');
      console.log('[usuarios] Arquivo criado com usuarios padrao');
      return defaultUsers.usuarios;
    }
    const raw = fs.readFileSync(USUARIOS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.usuarios) ? data.usuarios : [];
  } catch (err) {
    console.error('[usuarios] Erro ao carregar:', err.message);
    return [];
  }
}

let usuarios = carregarUsuarios();
let isEnvBased = !!process.env.NOC_USERS;

function salvarUsuarios() {
  if (isEnvBased) return false;
  try {
    fs.mkdirSync(path.dirname(USUARIOS_FILE), { recursive: true });
    fs.writeFileSync(USUARIOS_FILE, JSON.stringify({ usuarios }, null, 2), 'utf8');
    return true;
  } catch (_) { return false; }
}

function listarUsuarios() {
  return usuarios.map(u => ({ usuario: u.usuario, perfil: u.perfil, nome: u.nome }));
}

function criarUsuario(usuario, senha, perfil, nome) {
  if (isEnvBased) throw new Error('Usuarios gerenciados via NOC_USERS env var');
  const u = String(usuario).trim().toLowerCase();
  if (!u) throw new Error('Usuario obrigatorio');
  if (usuarios.find(x => x.usuario === u)) throw new Error('Usuario ja existe');
  if (!senha || senha.length < 4) throw new Error('Senha deve ter no minimo 4 caracteres');
  if (!['admin','operador'].includes(perfil)) throw new Error('Perfil deve ser admin ou operador');
  usuarios.push({ usuario: u, senha, perfil, nome: String(nome || u).trim() });
  salvarUsuarios();
  return { usuario: u, perfil, nome: String(nome || u).trim() };
}

function atualizarUsuario(usuario, dados) {
  if (isEnvBased) throw new Error('Usuarios gerenciados via NOC_USERS env var');
  const u = usuarios.find(x => x.usuario === String(usuario).trim().toLowerCase());
  if (!u) throw new Error('Usuario nao encontrado');
  if (dados.senha) {
    if (dados.senha.length < 4) throw new Error('Senha deve ter no minimo 4 caracteres');
    u.senha = dados.senha;
  }
  if (dados.perfil && ['admin','operador'].includes(dados.perfil)) u.perfil = dados.perfil;
  if (dados.nome) u.nome = String(dados.nome).trim();
  salvarUsuarios();
  return { usuario: u.usuario, perfil: u.perfil, nome: u.nome };
}

function removerUsuario(usuario) {
  if (isEnvBased) throw new Error('Usuarios gerenciados via NOC_USERS env var');
  const idx = usuarios.findIndex(x => x.usuario === String(usuario).trim().toLowerCase());
  if (idx < 0) throw new Error('Usuario nao encontrado');
  if (usuarios.length <= 1) throw new Error('Nao pode remover o unico usuario');
  const removed = usuarios.splice(idx, 1)[0];
  salvarUsuarios();
  return { usuario: removed.usuario };
}

function login(usuario, senha) {
  const u = usuarios.find(u => u.usuario === usuario && u.senha === senha);
  if (!u) return null;
  const token = crypto.randomBytes(24).toString('hex');
  sessoes.set(token, { usuario: u.usuario, perfil: u.perfil, nome: u.nome });
  return token;
}

function validaToken(token) {
  if (!token || typeof token !== 'string') return null;
  return sessoes.get(token) || null;
}

function logout(token) {
  sessoes.delete(token);
}

function authMiddlewareNoc(req, res, next) {
  const token = req.get('X-Noc-Token') || req.query.token;
  if (!token) return res.status(401).json({ ok: false, error: 'Token de acesso necessario' });
  const sessao = validaToken(token);
  if (!sessao) return res.status(401).json({ ok: false, error: 'Sessao invalida ou expirada' });
  req.usuarioSessao = sessao;
  next();
}

function authMiddlewarePerfil(...perfis) {
  return (req, res, next) => {
    if (!req.usuarioSessao) return res.status(401).json({ ok: false, error: 'Nao autenticado' });
    if (!perfis.includes(req.usuarioSessao.perfil)) return res.status(403).json({ ok: false, error: 'Acesso negado para este perfil' });
    next();
  };
}

module.exports = { login, validaToken, logout, authMiddlewareNoc, authMiddlewarePerfil, listarUsuarios, criarUsuario, atualizarUsuario, removerUsuario, isEnvBased: () => isEnvBased };
