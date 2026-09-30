// Gera preview.html: site + admin funcionando num único arquivo, com API simulada no navegador (localStorage).
// Uso: node build-preview.js   → abra preview.html no navegador. Login de teste: admin / preview
const fs = require('fs'), path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const css = rd('public/style.css');
const courses = rd('data/courses.json');

const shim = `<script>
(function(){
  var KEY='posunivicosa-preview', mem=null;
  function load(){ try{var s=localStorage.getItem(KEY); if(s) return JSON.parse(s);}catch(e){} return mem; }
  function save(d){ mem=d; try{localStorage.setItem(KEY,JSON.stringify(d));}catch(e){} }
  var db = load() || {courses:${courses}, contact:{whatsapp:'',email:'posgraduacao@univicosa.com.br',phone:''}};
  var logged = false;
  function json(s,b){ return Promise.resolve(new Response(JSON.stringify(b),{status:s,headers:{'Content-Type':'application/json'}})); }
  var slug=function(s){return s.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');};
  function clean(b){ return {nome:String(b.nome||'').trim(),area:String(b.area||'').trim(),tipo:b.tipo||'Especialização',modalidade:b.modalidade||'Presencial',
    cargaHoraria:parseInt(b.cargaHoraria,10)||0,duracao:b.duracao||'',valor:b.valor||'',inicio:b.inicio||'',descricao:b.descricao||'',publico:b.publico||'',destaque:!!b.destaque,ativo:b.ativo!==false}; }
  window.fetch=function(url,o){
    o=o||{}; var m=o.method||'GET', p=String(url).split('?')[0], b=o.body?JSON.parse(o.body):{}, r;
    if(p==='/api/courses') return json(200,{courses:db.courses.filter(function(c){return c.ativo}),contact:db.contact});
    if(p==='/api/admin/login'){ if(b.user==='admin'&&b.password==='preview'){logged=true;return json(200,{ok:true});} return json(401,{error:'Usuário ou senha inválidos. (preview: admin / preview)'}); }
    if(p==='/api/admin/logout'){logged=false;return json(200,{ok:true});}
    if(!logged) return json(401,{error:'Não autenticado'});
    if(p==='/api/admin/me') return json(200,{user:'admin'});
    if(p==='/api/admin/settings'){ if(m==='PUT'){db.contact=b.contact;save(db);} return json(200,{user:'admin',contact:db.contact}); }
    if(p==='/api/admin/password') return json(200,{ok:true});
    if(p==='/api/admin/courses'){
      if(m==='GET') return json(200,{courses:db.courses});
      var c=clean(b); if(c.nome.length<3||!c.area) return json(400,{error:'Informe nome (mín. 3) e área.'});
      var id=slug(c.nome)||String(Date.now()); if(db.courses.some(function(x){return x.id===id})) id+='-'+Date.now()%1000;
      c.id=id; db.courses.push(c); save(db); return json(201,c);
    }
    if(r=/^\\/api\\/admin\\/courses\\/([a-z0-9-]+)(\\/toggle)?$/.exec(p)){
      var i=db.courses.findIndex(function(x){return x.id===r[1]}); if(i<0) return json(404,{error:'Curso não encontrado'});
      if(r[2]){db.courses[i].ativo=!db.courses[i].ativo;}
      else if(m==='PUT'){var n=clean(b); if(n.nome.length<3||!n.area) return json(400,{error:'Informe nome (mín. 3) e área.'}); db.courses[i]=Object.assign({},db.courses[i],n);}
      else if(m==='DELETE'){db.courses.splice(i,1);save(db);return json(200,{ok:true});}
      save(db); return json(200,db.courses[i]);
    }
    return json(404,{error:'Rota inexistente'});
  };
})();
<\/script>`;

const page = (html, extraJs) => {
  let h = html.replace('<link rel="stylesheet" href="/style.css">', `<style>${css}</style>`);
  if (extraJs) h = h.replace('<script src="/admin.js"></script>', `<script>${extraJs}<\/script>`);
  return h.replace('<head>', '<head>' + shim);
};
const site = page(rd('public/index.html'));
const admin = page(rd('public/admin.html'), rd('public/admin.js'));
const esc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const inScript = v => JSON.stringify(v).replace(/<\/script/gi, '<\\/script');
fs.writeFileSync(path.join(__dirname, 'preview.html'), `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prévia | Pós-Graduação Univiçosa</title>
<style>
body{margin:0;font-family:system-ui,sans-serif;background:#0b2a5b;height:100vh;display:flex;flex-direction:column}
.bar{display:flex;gap:8px;align-items:center;padding:10px 14px;color:#fff;font-size:.85rem;flex-wrap:wrap}
.bar button{font:inherit;font-weight:700;border:0;border-radius:8px;padding:7px 14px;cursor:pointer;background:#ffffff22;color:#fff}
.bar button.on{background:#e0a526;color:#2b1d00}
.bar span{margin-left:auto;opacity:.8}
iframe{flex:1;border:0;background:#fff;width:100%}
</style></head><body>
<div class="bar"><button id="b1" class="on">Site público</button><button id="b2">Área admin</button>
<span>PRÉVIA — dados só neste navegador · login admin: <b>admin</b> / <b>preview</b> · volte ao "Site público" para ver as mudanças</span></div>
<iframe id="f"></iframe>
<script>
var pages={1:${inScript(site)},2:${inScript(admin)}};
var f=document.getElementById('f');
function show(n){f.srcdoc=pages[n];b1.className=n==1?'on':'';b2.className=n==2?'on':'';}
b1.onclick=function(){show(1)};b2.onclick=function(){show(2)};show(1);
</script>
</body></html>`);
