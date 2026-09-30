# Pós-Graduação Univiçosa — página de divulgação + painel admin

Sem dependências externas (Node ≥ 18).

```bash
ADMIN_USER=admin ADMIN_PASSWORD='sua-senha-forte' npm start   # http://localhost:3000
```

- **Site público:** `/` — lista apenas cursos **ativos**, com busca e filtros (área, modalidade, tipo) e botão WhatsApp/e-mail.
- **Admin:** `/admin` — login, cadastrar/editar/ativar/desativar/excluir cursos (com foto), contato exibido no site e troca de senha.
- **Fotos dos cursos:** enviadas no formulário do curso (JPG/PNG/WebP, até 4 MB após o envio). O admin recorta em 16:9 e comprime no navegador. Só aceita imagem verdadeira (validada pelos bytes; SVG é recusado). Ficam em `data/uploads/`; a foto é apagada ao trocar/remover/excluir o curso, e uploads abandonados há mais de 24h são limpos. Sem foto, o site mostra um visual padrão com as iniciais do curso.
- **Dados:** `data/courses.json` (cursos), `data/uploads/` (fotos) e `data/config.json` (credenciais com hash scrypt; ignorado pelo git). Faça backup de `data/`.
- Sem `ADMIN_PASSWORD` no 1º start, a senha inicial é `univicosa@2026` — **troque no painel**.
- Em produção atrás de HTTPS, defina `COOKIE_SECURE=1`. Desativar = some do site mas o cadastro é mantido; Excluir = remove definitivamente.
- `npm test` roda o teste de fumaça da API.

Possível evolução: integrar os interessados ao Rubeus (lead via API) e ao Worknow, e sincronizar cursos/ofertas com o RM (Educacional).
