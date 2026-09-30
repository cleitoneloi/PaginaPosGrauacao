# Pós-Graduação Univiçosa — página de divulgação + painel admin

Sem dependências externas (Node ≥ 18).

```bash
ADMIN_USER=admin ADMIN_PASSWORD='sua-senha-forte' npm start   # http://localhost:3000
```

- **Site público:** `/` — lista apenas cursos **ativos**, com busca e filtros (área, modalidade, tipo) e botão WhatsApp/e-mail.
- **Admin:** `/admin` — login, cadastrar/editar/ativar/desativar/excluir cursos, contato exibido no site e troca de senha.
- **Dados:** `data/courses.json` (cursos) e `data/config.json` (credenciais com hash scrypt; ignorado pelo git). Faça backup de `data/`.
- Sem `ADMIN_PASSWORD` no 1º start, a senha inicial é `univicosa@2026` — **troque no painel**.
- Em produção atrás de HTTPS, defina `COOKIE_SECURE=1`. Desativar = some do site mas o cadastro é mantido; Excluir = remove definitivamente.
- `npm test` roda o teste de fumaça da API.

Possível evolução: integrar os interessados ao Rubeus (lead via API) e ao Worknow, e sincronizar cursos/ofertas com o RM (Educacional).
