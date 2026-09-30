const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
let courses = [], editingId = null;

async function api(path, method = 'GET', body) {
  const r = await fetch('/api/admin' + path, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
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
  const n = el('td'); const b = el('b', '', c.nome); n.append(b); if (c.destaque) n.append(' ', el('span', 'tag gold', '★'));
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
  body.destaque = form.elements.destaque.checked; body.ativo = form.elements.ativo.checked;
  try {
    if (editingId) await api('/courses/' + editingId, 'PUT', body); else await api('/courses', 'POST', body);
    $('#dlg').close(); toast('Curso salvo'); loadCourses();
  } catch (err) { $('#ferr').textContent = err.message; }
});

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
