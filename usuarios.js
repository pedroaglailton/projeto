const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USUARIOS_FILE = path.join(__dirname, 'data', 'usuarios.json');
const sessoes = new Map(); // token -> { usuario, perfil, nome }

function carregarUsuarios() {
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

module.exports = { login, validaToken, logout, authMiddlewareNoc, authMiddlewarePerfil, sessoes };
