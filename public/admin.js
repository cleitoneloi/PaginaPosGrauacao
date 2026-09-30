const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
let courses = [], editingId = null, currentImage = '', uploading = false;

async function api(path, method = 'GET', body) {
  const isBlob = body instanceof Blob;
  const r = await fetch('/api/admin' + path, {
    method,
    headers: body ? { 'Content-Type': isBlob ? body.type : 'application/json' } : {},
    body: body ? (isBlob ? body : JSON.stringify(body)) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/login') { showLogin(); throw new Error('Sessão expirada. Faça login novamente.'); }
  if (!r.ok) throw new Error(data.error || 'Erro ' + r.status);
  return data;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2600); }
const showLogin = () => { $('#app').hidden = true; $('#login').hidden = false; };

async function boot() {
  try { await api('/me'); } catch { return showLogin(); }
  $('#login').hidden = true; $('#app').hidden = false;
  await Promise.all([loadCourses(), loadSettings()]);
}

$('#login').addEventListener('submit', async e => {
  e.preventDefault(); $('#lerr').textContent = '';
  try { await api('/login', 'POST', { user: $('#lu').value, password: $('#lp').value }); $('#lp').value = ''; boot(); }
  catch (err) { $('#lerr').textContent = err.message; }
});
$('#logout').addEventListener('click', async e => { e.preventDefault(); await api('/logout', 'POST').catch(() => {}); showLogin(); });

document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x === b));
  $('#tab-cursos').hidden = b.dataset.tab !== 'cursos'; $('#tab-config').hidden = b.dataset.tab !== 'config';
}));

/* ---- cursos ---- */
async function loadCourses() { courses = (await api('/courses')).courses; render(); }

function render() {
  const q = $('#aq').value.trim().toLowerCase(), s = $('#as').value;
  const ativos = courses.filter(c => c.ativo).length;
  $('#stats').replaceChildren(...[['Total', courses.length], ['Ativos', ativos], ['Inativos', courses.length - ativos]].map(([k, v]) => {
    const d = el('div', 'stat'); d.append(el('b', '', v), document.createTextNode(k)); return d;
  }));
  $('#areas').replaceChildren(...[...new Set(courses.map(c => c.area))].map(a => { const o = el('option'); o.value = a; return o; }));
  const list = courses.filter(c => (!s || String(+c.ativo) === s) && (!q || (c.nome + ' ' + c.area).toLowerCase().includes(q)))
    .sort((a, b) => b.ativo - a.ativo || a.nome.localeCompare(b.nome, 'pt-BR'));
  $('#rows').replaceChildren(...list.map(row));
  if (!list.length) { const tr = el('tr'); const td = el('td', '', 'Nenhum curso encontrado.'); td.colSpan = 5; tr.append(td); $('#rows').append(tr); }
}

function row(c) {
  const tr = el('tr', c.ativo ? '' : 'inactive');
  const n = el('td'); const nc = el('div', 'namecell');
  let th;
  if (c.imagem) { th = el('img', 'thumb'); th.src = c.imagem; th.alt = ''; th.loading = 'lazy'; }
  else { th = el('div', 'thumb none', '—'); th.style.background = '#b8c2d6'; }
  const b = el('b', '', c.nome); nc.append(th, b); if (c.destaque) nc.append(el('span', 'tag gold', '★')); n.append(nc);
  const st = el('td'); st.append(el('span', 'tag ' + (c.ativo ? 'on' : 'off'), c.ativo ? 'Ativo' : 'Inativo'));
  const act = el('td', 'actions');
  const mk = (txt, cls, fn) => { const x = el('button', 'btn sm ' + cls, txt); x.addEventListener('click', fn); return x; };
  act.append(
    mk('Editar', 'ghost', () => openForm(c)),
    mk(c.ativo ? 'Desativar' : 'Ativar', 'ghost', async () => {
      try { await api(`/courses/${c.id}/toggle`, 'POST'); toast(c.ativo ? 'Curso desativado' : 'Curso ativado'); loadCourses(); } catch (e) { toast(e.message); }
    }),
    mk('Excluir', 'danger', async () => {
      if (!confirm(`Excluir definitivamente "${c.nome}"?\n\nDica: para apenas retirar do site, use "Desativar".`)) return;
      try { await api(`/courses/${c.id}`, 'DELETE'); toast('Curso excluído'); loadCourses(); } catch (e) { toast(e.message); }
    }));
  const tm = el('td', '', `${c.tipo} · ${c.modalidade}`);
  tr.append(n, el('td', '', c.area), tm, st, act);
  return tr;
}
$('#aq').addEventListener('input', render); $('#as').addEventListener('input', render);

/* ---- formulário ---- */
const form = $('#form');
function openForm(c) {
  editingId = c ? c.id : null;
  $('#dlgTitle').textContent = c ? 'Editar curso' : 'Novo curso';
  $('#ferr').textContent = '';
  form.reset();
  $('#imgErr').textContent = '';
  setImage(c ? c.imagem || '' : '');
  if (c) for (const [k, v] of Object.entries(c)) {
    const f = form.elements[k]; if (!f) continue;
    if (f.type === 'checkbox') f.checked = !!v; else f.value = v;
  }
  $('#dlg').showModal();
}
$('#newBtn').addEventListener('click', () => openForm(null));
$('#cancel').addEventListener('click', () => $('#dlg').close());
form.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(form);
  const body = Object.fromEntries(fd.entries());
  if (uploading) { $('#ferr').textContent = 'Aguarde o envio da imagem terminar.'; return; }
  body.destaque = form.elements.destaque.checked; body.ativo = form.elements.ativo.checked; body.imagem = currentImage;
  try {
    if (editingId) await api('/courses/' + editingId, 'PUT', body); else await api('/courses', 'POST', body);
    $('#dlg').close(); toast('Curso salvo'); loadCourses();
  } catch (err) { $('#ferr').textContent = err.message; }
});

/* ---- imagem do curso ---- */
const MAX_INPUT = 20 * 1024 * 1024;
function setImage(url) {
  currentImage = url;
  const prev = $('#imgPrev');
  if (url) { const img = el('img'); img.src = url; img.alt = 'Prévia da foto do curso'; prev.replaceChildren(img); }
  else prev.replaceChildren(el('span', '', 'Sem foto — clique ou arraste uma imagem aqui'));
  $('#imgRemove').hidden = !url;
  $('#imgPick').textContent = url ? 'Trocar imagem' : 'Escolher imagem';
}
/** Recorta no centro em 16:9, limita a 1280px de largura e comprime em JPEG. */
async function processImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Use uma imagem JPG, PNG ou WebP.');
  if (file.size > MAX_INPUT) throw new Error('Imagem muito grande (máx. 20 MB).');
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('Não foi possível ler essa imagem.'); }
  const ratio = 16 / 9;
  let sw = bmp.width, sh = bmp.height, sx = 0, sy = 0;
  if (sw / sh > ratio) { const nw = sh * ratio; sx = (sw - nw) / 2; sw = nw; } else { const nh = sw / ratio; sy = (sh - nh) / 2; sh = nh; }
  const w = Math.min(1280, Math.round(sw)), h = Math.round(w / ratio);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); // PNG com transparência vira fundo branco
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('Falha ao processar a imagem.');
  return blob;
}
async function handleFile(file) {
  if (!file) return;
  $('#imgErr').textContent = '';
  uploading = true; $('#imgPrev').classList.add('busy'); $('#save').disabled = true;
  try {
    const blob = await processImage(file);
    const { url } = await api('/upload', 'POST', blob);
    setImage(url);
  } catch (err) { $('#imgErr').textContent = err.message; }
  finally { uploading = false; $('#imgPrev').classList.remove('busy'); $('#save').disabled = false; $('#imgFile').value = ''; }
}
$('#imgPick').addEventListener('click', () => $('#imgFile').click());
$('#imgPrev').addEventListener('click', () => $('#imgFile').click());
$('#imgFile').addEventListener('change', e => handleFile(e.target.files[0]));
$('#imgRemove').addEventListener('click', () => { setImage(''); $('#imgErr').textContent = ''; });
['dragenter', 'dragover'].forEach(ev => $('#imgPrev').addEventListener(ev, e => { e.preventDefault(); $('#imgPrev').classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => $('#imgPrev').addEventListener(ev, e => { e.preventDefault(); $('#imgPrev').classList.remove('drag'); }));
$('#imgPrev').addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));

/* ---- configurações ---- */
async function loadSettings() {
  const s = await api('/settings');
  $('#cw').value = s.contact.whatsapp || ''; $('#ce').value = s.contact.email || ''; $('#cp').value = s.contact.phone || '';
}
$('#contactForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { await api('/settings', 'PUT', { contact: { whatsapp: $('#cw').value, email: $('#ce').value, phone: $('#cp').value } }); toast('Contato salvo'); } catch (err) { toast(err.message); }
});
$('#pwForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { await api('/password', 'POST', { current: $('#pc').value, next: $('#pn').value }); e.target.reset(); toast('Senha alterada'); } catch (err) { toast(err.message); }
});

boot();
