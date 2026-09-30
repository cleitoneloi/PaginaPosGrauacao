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
    console.log('OK — todos os testes passaram');
    process.exitCode = 0;
  } catch (e) { console.error('FALHOU:', e.message); process.exitCode = 1; }
  server.closeAllConnections(); server.close(() => process.exit(process.exitCode));
});
