'use strict';
/**
 * Servidor da página de Pós-Graduação Univiçosa — zero dependências (Node >= 18).
 *  - Público:  GET /            → vitrine de cursos ativos
 *  - Admin:    GET /admin       → login + painel (CRUD, ativar/desativar, excluir)
 *  - API:      /api/courses (público, só ativos) | /api/admin/* (autenticado)
 * Persistência: data/courses.json (escrita atômica) e data/config.json (credenciais/contato).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const COURSES_FILE = path.join(DATA_DIR, 'courses.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const SESSION_TTL = 8 * 60 * 60 * 1000;
const MAX_BODY = 1024 * 1024;
const MAX_IMAGE = 4 * 1024 * 1024;
const NAME_RE = /^[a-f0-9]{24}\.(jpg|png|webp)$/;
const IMG_URL_RE = /^\/uploads\/([a-f0-9]{24}\.(?:jpg|png|webp))$/;
const ORPHAN_MAX_AGE = 24 * 60 * 60 * 1000;

const MIME = {
  '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

/* ---------- persistência ---------- */
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
const hashPassword = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  ({ salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') });
const checkPassword = (pw, { salt, hash }) => {
  const a = Buffer.from(crypto.scryptSync(pw, salt, 64).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

function loadConfig() {
  let cfg = readJson(CONFIG_FILE, null);
  if (!cfg) {
    const initial = process.env.ADMIN_PASSWORD || 'univicosa@2026';
    cfg = {
      user: process.env.ADMIN_USER || 'admin',
      password: hashPassword(initial),
      contact: { whatsapp: '', email: 'posgraduacao@univicosa.com.br', phone: '' },
    };
    writeJson(CONFIG_FILE, cfg);
    if (!process.env.ADMIN_PASSWORD) {
      console.warn(`[!] Senha inicial padrão em uso (usuário "${cfg.user}", senha "${initial}"). Troque-a no painel ou defina ADMIN_PASSWORD antes do 1º start.`);
    }
  }
  return cfg;
}
let config = loadConfig();

/* ---------- sessões e rate limit de login ---------- */
const sessions = new Map(); // token -> expira
const attempts = new Map(); // ip -> {n, until}
const newSession = () => {
  const t = crypto.randomBytes(32).toString('hex');
  sessions.set(t, Date.now() + SESSION_TTL);
  return t;
};
function getToken(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || '');
  return m && m[1];
}
function isAuth(req) {
  const t = getToken(req);
  const exp = t && sessions.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}

/* ---------- validação de cursos ---------- */
const MODALIDADES = ['Presencial', 'EAD', 'Semipresencial'];
const TIPOS = ['Especialização', 'MBA', 'Residência', 'Extensão'];
const str = (v, max) => String(v ?? '').trim().slice(0, max);

function sanitizeCourse(body) {
  const c = {
    nome: str(body.nome, 140),
    area: str(body.area, 80),
    tipo: TIPOS.includes(body.tipo) ? body.tipo : 'Especialização',
    modalidade: MODALIDADES.includes(body.modalidade) ? body.modalidade : 'Presencial',
    cargaHoraria: Math.max(0, parseInt(body.cargaHoraria, 10) || 0),
    duracao: str(body.duracao, 60),
    valor: str(body.valor, 80),
    inicio: str(body.inicio, 60),
    descricao: str(body.descricao, 1500),
    publico: str(body.publico, 400),
    destaque: !!body.destaque,
    ativo: body.ativo !== false,
  };
  if ('imagem' in body) c.imagem = validImage(body.imagem);
  const errors = [];
  if (c.nome.length < 3) errors.push('Informe o nome do curso (mín. 3 caracteres).');
  if (!c.area) errors.push('Informe a área.');
  return { c, errors };
}

/* ---------- imagens ---------- */
function sniffImage(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}
function validImage(v) {
  const m = IMG_URL_RE.exec(String(v ?? ''));
  return m && fs.existsSync(path.join(UPLOADS_DIR, m[1])) ? v : '';
}
/** Remove o arquivo se nenhum curso da lista ainda o referencia. */
function releaseImage(url, list) {
  const m = IMG_URL_RE.exec(String(url ?? ''));
  if (!m || list.some(c => c.imagem === url)) return;
  try { fs.unlinkSync(path.join(UPLOADS_DIR, m[1])); } catch { /* já removido */ }
}
/** Apaga uploads abandonados (enviados e nunca salvos em um curso) com mais de 24h. */
function sweepUploads() {
  let files;
  try { files = fs.readdirSync(UPLOADS_DIR); } catch { return; }
  const used = new Set(loadCourses().map(c => c.imagem && path.basename(c.imagem)));
  for (const f of files) {
    if (!NAME_RE.test(f) || used.has(f)) continue;
    const full = path.join(UPLOADS_DIR, f);
    try { if (Date.now() - fs.statSync(full).mtimeMs > ORPHAN_MAX_AGE) fs.unlinkSync(full); } catch { /* ignora */ }
  }
}

const slugify = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const loadCourses = () => readJson(COURSES_FILE, []);
const saveCourses = list => writeJson(COURSES_FILE, list);

/* ---------- helpers HTTP ---------- */
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
function readRaw(req, max, msg = 'Payload grande demais') {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => { size += d.length; if (size <= max) chunks.push(d); }); // excedente é descartado, mas lido até o fim para a resposta 413 chegar ao cliente
    req.on('end', () => size > max ? reject(Object.assign(new Error(msg), { status: 413 })) : resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readBody(req) {
  const buf = await readRaw(req, MAX_BODY);
  try { return buf.length ? JSON.parse(buf.toString('utf8')) : {}; }
  catch { throw Object.assign(new Error('JSON inválido'), { status: 400 }); }
}
function serveUpload(res, name) {
  fs.readFile(path.join(UPLOADS_DIR, name), (err, buf) => {
    if (err) return send(res, 404, 'Não encontrado');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(name)],
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=31536000, immutable', // nome aleatório e único por arquivo
    });
    res.end(buf);
  });
}
function serveStatic(req, res, file) {
  const full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Proibido');
  fs.readFile(full, (err, buf) => {
    if (err) return send(res, 404, 'Não encontrado');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

/* ---------- rotas ---------- */
async function handleApi(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  // Público
  if (p === '/api/courses' && m === 'GET') {
    const list = loadCourses().filter(c => c.ativo);
    return send(res, 200, { courses: list, contact: config.contact });
  }

  // Login / logout
  if (p === '/api/admin/login' && m === 'POST') {
    const ip = req.socket.remoteAddress;
    const a = attempts.get(ip) || { n: 0, until: 0 };
    if (a.until > Date.now()) return send(res, 429, { error: 'Muitas tentativas. Aguarde alguns minutos.' });
    const b = await readBody(req);
    const userOk = str(b.user, 100) === config.user;
    const passOk = checkPassword(String(b.password ?? ''), config.password);
    if (!(userOk && passOk)) {
      a.n += 1;
      if (a.n >= 5) { a.n = 0; a.until = Date.now() + 5 * 60 * 1000; }
      attempts.set(ip, a);
      return send(res, 401, { error: 'Usuário ou senha inválidos.' });
    }
    attempts.delete(ip);
    const t = newSession();
    return send(res, 200, { ok: true }, {
      'Set-Cookie': `sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`,
    });
  }
  if (p === '/api/admin/logout' && m === 'POST') {
    sessions.delete(getToken(req));
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (!p.startsWith('/api/admin/')) return send(res, 404, { error: 'Rota inexistente' });
  if (!isAuth(req)) return send(res, 401, { error: 'Não autenticado' });

  // CSRF: mutações exigem mesma origem
  if (m !== 'GET') {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'Origem inválida' });
  }

  if (p === '/api/admin/me' && m === 'GET') return send(res, 200, { user: config.user });

  if (p === '/api/admin/upload' && m === 'POST') {
    const buf = await readRaw(req, MAX_IMAGE, 'Imagem muito grande (máx. 4 MB).');
    const ext = sniffImage(buf);
    if (!ext) return send(res, 400, { error: 'Arquivo inválido. Envie uma imagem JPG, PNG ou WebP.' });
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
    sweepUploads();
    return send(res, 201, { url: '/uploads/' + name });
  }

  if (p === '/api/admin/courses' && m === 'GET') return send(res, 200, { courses: loadCourses() });

  if (p === '/api/admin/courses' && m === 'POST') {
    const { c, errors } = sanitizeCourse(await readBody(req));
    if (errors.length) return send(res, 400, { error: errors.join(' ') });
    const list = loadCourses();
    let id = slugify(c.nome) || crypto.randomUUID();
    if (list.some(x => x.id === id)) id += '-' + crypto.randomBytes(2).toString('hex');
    const now = new Date().toISOString();
    const course = { id, imagem: '', ...c, criadoEm: now, atualizadoEm: now };
    list.push(course);
    saveCourses(list);
    return send(res, 201, course);
  }

  const cm = /^\/api\/admin\/courses\/([a-z0-9-]+)(\/toggle)?$/.exec(p);
  if (cm) {
    const list = loadCourses();
    const i = list.findIndex(x => x.id === cm[1]);
    if (i < 0) return send(res, 404, { error: 'Curso não encontrado' });

    if (cm[2] && m === 'POST') {
      list[i].ativo = !list[i].ativo;
      list[i].atualizadoEm = new Date().toISOString();
      saveCourses(list);
      return send(res, 200, list[i]);
    }
    if (!cm[2] && m === 'PUT') {
      const { c, errors } = sanitizeCourse(await readBody(req));
      if (errors.length) return send(res, 400, { error: errors.join(' ') });
      const oldImage = list[i].imagem;
      list[i] = { ...list[i], ...c, atualizadoEm: new Date().toISOString() };
      saveCourses(list);
      if (oldImage !== list[i].imagem) releaseImage(oldImage, list);
      return send(res, 200, list[i]);
    }
    if (!cm[2] && m === 'DELETE') {
      const [removed] = list.splice(i, 1);
      saveCourses(list);
      releaseImage(removed.imagem, list);
      return send(res, 200, { ok: true, removed: removed.id });
    }
  }

  if (p === '/api/admin/settings' && m === 'GET') return send(res, 200, { user: config.user, contact: config.contact });
  if (p === '/api/admin/settings' && m === 'PUT') {
    const b = await readBody(req);
    config.contact = {
      whatsapp: str(b.contact?.whatsapp, 20).replace(/\D/g, ''),
      email: str(b.contact?.email, 120),
      phone: str(b.contact?.phone, 40),
    };
    writeJson(CONFIG_FILE, config);
    return send(res, 200, { contact: config.contact });
  }
  if (p === '/api/admin/password' && m === 'POST') {
    const b = await readBody(req);
    if (!checkPassword(String(b.current ?? ''), config.password)) return send(res, 400, { error: 'Senha atual incorreta.' });
    const next = String(b.next ?? '');
    if (next.length < 8) return send(res, 400, { error: 'A nova senha deve ter ao menos 8 caracteres.' });
    config.password = hashPassword(next);
    writeJson(CONFIG_FILE, config);
    const keep = getToken(req);
    for (const t of sessions.keys()) if (t !== keep) sessions.delete(t);
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'Rota inexistente' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método não permitido');
    const um = IMG_URL_RE.exec(url.pathname);
    if (um) return serveUpload(res, um[1]);
    if (url.pathname === '/') return serveStatic(req, res, 'index.html');
    if (url.pathname === '/admin' || url.pathname === '/admin/') return serveStatic(req, res, 'admin.html');
    return serveStatic(req, res, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Erro interno' : e.message });
  }
});

if (require.main === module) {
  sweepUploads();
  server.listen(PORT, () => console.log(`Pós-Graduação Univiçosa em http://localhost:${PORT}  (admin: /admin)`));
}
module.exports = { server, reloadConfig: () => { config = loadConfig(); } };
