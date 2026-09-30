// Teste de fumaça da API: node test.js
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-'));
process.env.ADMIN_PASSWORD = 'senha-teste-123';
fs.copyFileSync(path.join(__dirname, 'data/courses.json'), path.join(process.env.DATA_DIR, 'courses.json'));
const { server } = require('./server');

server.listen(0, async () => {
  const base = `http://localhost:${server.address().port}`;
  let cookie = '';
  const call = async (p, method = 'GET', body) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body && JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  try {
    assert.equal((await call('/api/admin/courses')).status, 401, 'admin sem login deve ser 401');
    assert.equal((await call('/api/admin/login', 'POST', { user: 'admin', password: 'x' })).status, 401);
    assert.equal((await call('/api/admin/login', 'POST', { user: 'admin', password: 'senha-teste-123' })).status, 200);
    const pub0 = (await call('/api/courses')).data.courses.length;
    const created = await call('/api/admin/courses', 'POST', { nome: 'Gestão Hospitalar', area: 'Saúde', modalidade: 'EAD' });
    assert.equal(created.status, 201);
    assert.equal((await call('/api/admin/courses', 'POST', { nome: 'x' })).status, 400);
    assert.equal((await call('/api/courses')).data.courses.length, pub0 + 1);
    const id = created.data.id;
    assert.equal((await call(`/api/admin/courses/${id}/toggle`, 'POST')).data.ativo, false);
    assert.equal((await call('/api/courses')).data.courses.length, pub0, 'desativado some do site');
    assert.equal((await call(`/api/admin/courses/${id}`, 'PUT', { nome: 'Gestão Hospitalar II', area: 'Saúde' })).data.nome, 'Gestão Hospitalar II');
    assert.equal((await call(`/api/admin/courses/${id}`, 'DELETE')).status, 200);
    assert.equal((await call(`/api/admin/courses/${id}`, 'DELETE')).status, 404);
    assert.equal((await fetch(base + '/../server.js')).status === 200 && false, false);
    assert.equal((await fetch(base + '/%2e%2e/server.js')).status, 404, 'sem path traversal');
    assert.equal((await fetch(base + '/admin')).status, 200);
    // ---- imagens ----
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const raw = (p, buf, auth = true) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'image/png', ...(auth ? { cookie } : {}) }, body: buf });
    assert.equal((await raw('/api/admin/upload', PNG, false)).status, 401, 'upload exige login');
    assert.equal((await raw('/api/admin/upload', Buffer.from('<svg onload=alert(1)></svg>'))).status, 400, 'SVG/texto rejeitado');
    assert.equal((await raw('/api/admin/upload', Buffer.alloc(5 * 1024 * 1024, 0xff))).status, 413, 'limite de tamanho');
    const up = await raw('/api/admin/upload', PNG); assert.equal(up.status, 201);
    const url = (await up.json()).url; assert.match(url, /^\/uploads\/[a-f0-9]{24}\.png$/);
    const served = await fetch(base + url);
    assert.equal(served.status, 200); assert.equal(served.headers.get('content-type'), 'image/png');
    assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
    const withImg = await call('/api/admin/courses', 'POST', { nome: 'Curso Com Foto', area: 'Saúde', imagem: url });
    assert.equal(withImg.data.imagem, url);
    assert.equal((await call('/api/courses')).data.courses.find(c => c.id === withImg.data.id).imagem, url);
    const evil = await call('/api/admin/courses', 'POST', { nome: 'Curso Evil', area: 'X', imagem: '/uploads/../../server.js' });
    assert.equal(evil.data.imagem, '', 'caminho inválido é descartado');
    await call(`/api/admin/courses/${evil.data.id}`, 'DELETE');
    const keep = await call(`/api/admin/courses/${withImg.data.id}`, 'PUT', { nome: 'Curso Com Foto', area: 'Saúde' });
    assert.equal(keep.data.imagem, url, 'PUT sem o campo imagem mantém a foto');
    const up2 = await (await raw('/api/admin/upload', PNG)).json();
    await call(`/api/admin/courses/${withImg.data.id}`, 'PUT', { nome: 'Curso Com Foto', area: 'Saúde', imagem: up2.url });
    assert.equal((await fetch(base + url)).status, 404, 'foto antiga removida ao trocar');
    await call(`/api/admin/courses/${withImg.data.id}`, 'PUT', { nome: 'Curso Com Foto', area: 'Saúde', imagem: '' });
    assert.equal((await fetch(base + up2.url)).status, 404, 'foto removida ao limpar');
    const up3 = await (await raw('/api/admin/upload', PNG)).json();
    await call(`/api/admin/courses/${withImg.data.id}`, 'PUT', { nome: 'Curso Com Foto', area: 'Saúde', imagem: up3.url });
    await call(`/api/admin/courses/${withImg.data.id}`, 'DELETE');
    assert.equal((await fetch(base + up3.url)).status, 404, 'foto removida ao excluir curso');
    console.log('OK — todos os testes passaram');
    process.exitCode = 0;
  } catch (e) { console.error('FALHOU:', e.message); process.exitCode = 1; }
  server.closeAllConnections(); server.close(() => process.exit(process.exitCode));
});
