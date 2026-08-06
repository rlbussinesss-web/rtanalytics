# Deploy no Railway

Guia para colocar o RTAnalytics no ar. São **6 serviços**: dois gerenciados
pelo Railway (Redis e Postgres/Timescale) e quatro construídos a partir dos
Dockerfiles deste repositório.

| Serviço | Origem | Público? | Papel |
|---|---|---|---|
| `redis` | template Railway | não | presença online + fila de eventos (Redis Streams) + pub/sub ao vivo |
| `postgres` | template Railway | não | histórico de eventos |
| `ingest` | `apps/ingest/Dockerfile` | **sim** | recebe eventos dos sites monitorados via WebSocket |
| `dashboard-api` | `apps/dashboard-api/Dockerfile` | **sim** | serve o painel (REST + WebSocket ao vivo) |
| `workers` | `apps/workers/Dockerfile` | não | grava os eventos no banco em lotes |
| `dashboard-web` | `apps/dashboard-web/Dockerfile` | **sim** | painel React + `tracker.js` |

> Todos os Dockerfiles são construídos **a partir da raiz do repositório**
> (o monorepo pnpm precisa estar visível). No Railway, deixe o *Root
> Directory* de cada serviço como `/` e aponte o *Dockerfile Path* para
> `apps/<serviço>/Dockerfile`.

## 1. Pré-requisitos

- Código num repositório Git (GitHub) — o Railway constrói a partir dele.
- Conta no Railway.

## 2. Criar o projeto e a infraestrutura

No projeto do Railway, adicione os dois serviços gerenciados:

- **Redis** (Add Service → Database → Redis)
- **Postgres** (Add Service → Database → Postgres)

O Postgres padrão do Railway **não tem a extensão TimescaleDB**. Duas saídas:

1. **Sem Timescale** (recomendado para começar): a tabela `events` funciona
   como tabela Postgres comum. Você perde particionamento automático e
   compressão, o que só passa a importar com volume alto de eventos.
2. **Com Timescale**: crie o serviço a partir da imagem
   `timescale/timescaledb:latest-pg16` (Add Service → Docker Image) em vez do
   template de Postgres.

Aplique a migration `infra/migrations/001_init.sql` conectando na URL pública
do banco. Se estiver na opção 1, remova antes as linhas de
`create_hypertable`, compressão e retenção — elas exigem a extensão.

## 3. Gerar a senha do painel

O `dashboard-api` **se recusa a iniciar** sem `DASHBOARD_TOKEN`, para evitar
que um painel sem proteção vá ao ar por descuido. Gere uma senha longa:

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }))
```

Guarde-a: é ela que você e seu sócio digitam para entrar.

## 4. Criar os serviços da aplicação

Para cada um: New Service → GitHub Repo → este repositório → em *Settings*,
defina o *Dockerfile Path*. Depois configure as variáveis abaixo.

### `ingest` — público

```
REDIS_URL=${{Redis.REDIS_URL}}
ALLOWED_SITE_IDS=meu-site
```

Gere o domínio público (*Settings → Networking → Generate Domain*). O
`ALLOWED_SITE_IDS` é a lista de sites autorizados a enviar eventos; sem ela
qualquer um que descobrir a URL pode inserir dados falsos.

### `workers` — sem domínio público

```
REDIS_URL=${{Redis.REDIS_URL}}
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

### `dashboard-api` — público

```
REDIS_URL=${{Redis.REDIS_URL}}
DASHBOARD_TOKEN=<a senha gerada no passo 3>
CORS_ORIGINS=https://<domínio do dashboard-web>
```

### `dashboard-web` — público

O Vite embute os endereços da API **no momento do build**, então estes vão
como *build args*, não como variáveis de runtime (Railway → Settings →
Build → Build Arguments):

```
VITE_DASHBOARD_API_URL=https://<domínio do dashboard-api>
VITE_DASHBOARD_API_WS_URL=wss://<domínio do dashboard-api>
VITE_SITE_ID=meu-site
```

Note o `wss://` (não `ws://`): em HTTPS o navegador recusa WebSocket inseguro.
Se mudar o domínio da API depois, é preciso **reconstruir** este serviço.

## 5. Instalar o tracker no site monitorado

Cole antes de `</body>`:

```html
<script
  async
  src="https://<domínio do dashboard-web>/tracker.js"
  data-site-id="meu-site"
  data-ingest-url="wss://<domínio do ingest>"
></script>
```

O `data-site-id` precisa bater com `ALLOWED_SITE_IDS` do ingest e com
`VITE_SITE_ID` do painel.

## 6. Verificar

1. Abra o painel, digite a senha, confirme o selo **live** (verde).
2. Abra o site monitorado noutra aba.
3. O pageview deve aparecer no painel **na hora**, sem recarregar. Os
   heartbeats seguem a cada 15s enquanto a aba estiver aberta.
4. Confirme a persistência:
   `SELECT count(*), max(time) FROM events;` — deve crescer.

Se o painel conecta mas nada aparece: quase sempre é `ALLOWED_SITE_IDS`
divergindo do `data-site-id`, ou `ws://` no lugar de `wss://`. Os logs do
`ingest` mostram `unknown_site` no primeiro caso.

## 7. Custo esperado

Faixa de US$ 10–20/mês no início (Railway cobra por uso de CPU/RAM, e quatro
dos seis serviços ficam quase ociosos com pouco tráfego). O `workers` e o
`ingest` são os primeiros a crescer com o volume de visitantes.

## 8. Limitações conhecidas nesta fase

- Sem geo-IP/user-agent: as colunas `country`, `city`, `device`, `browser` e
  `os` ficam `NULL`.
- Senha única compartilhada, sem contas individuais — adequado para um time
  de duas pessoas, insuficiente para vender a terceiros (ver
  `apps/dashboard-api/src/auth.ts`).
- Sem replay de sessão, heatmaps ou funis (Fases 2 e 3 do plano).
- Sem backup automático configurado: ative os backups do Postgres no painel
  do Railway.
