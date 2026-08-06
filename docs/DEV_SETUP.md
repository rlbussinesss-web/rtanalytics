# RTAnalytics — Dev Setup (Fase 1)

Guia para subir o ambiente de desenvolvimento local no Windows (PowerShell).

## 1. Pré-requisitos

- Docker Desktop rodando
- Node.js v22+, pnpm 11+ (`npm install -g pnpm` se necessário)

## 2. Infraestrutura (Redis, TimescaleDB)

```powershell
Copy-Item infra\.env.example infra\.env
docker compose -f infra\docker-compose.yml --env-file infra\.env up -d
```

Isso sobe:
- Redis em `localhost:6379` (presença, fila de eventos via Redis Streams e pub/sub ao vivo)
- TimescaleDB (Postgres) em `localhost:5432`

O NATS foi removido: o log durável de eventos roda sobre Redis Streams, que
entrega a mesma garantia at-least-once nesta escala com um serviço a menos
para operar e pagar. O MinIO entra na Fase 2, junto com o replay de sessão.

A migration `infra/migrations/001_init.sql` é aplicada automaticamente no
primeiro boot do container do TimescaleDB (montada em
`/docker-entrypoint-initdb.d`). Se o volume já existir de uma execução
anterior, aplique manualmente:

```powershell
docker exec -i rtanalytics-timescaledb psql -U rtanalytics -d rtanalytics -f - < infra\migrations\001_init.sql
```

## 3. Instalar dependências e buildar os pacotes compartilhados

```powershell
pnpm install
pnpm -r build
```

Isso builda `packages/shared-types` e `packages/protocol` (dependências dos
apps Node) além de compilar/typecheck todos os apps.

## 4. Rodar os serviços em modo dev

Em terminais separados:

```powershell
pnpm dev:ingest          # Fastify WS em ws://localhost:8081
pnpm dev:dashboard-api   # Fastify REST+WS em http://localhost:8082
pnpm dev:workers         # worker de persistência (Redis Streams -> Timescale)
pnpm dev:dashboard-web   # Vite dev server, http://localhost:5173
```

Variáveis de ambiente relevantes (defaults já apontam para os serviços do
`docker-compose.yml` acima; sobrescreva se mudar portas/credenciais):

- `REDIS_URL` (default `redis://localhost:6379`)
- `DATABASE_URL` (default `postgres://rtanalytics:rtanalytics_dev_password@localhost:5432/rtanalytics`)
- `INGEST_PORT` (default `8081`)
- `ALLOWED_SITE_IDS` (vazio = aceita qualquer site; use só em dev)
- `DASHBOARD_API_PORT` (default `8082`)
- `DASHBOARD_TOKEN` (**obrigatório** — o `dashboard-api` não inicia sem ele;
  em dev use qualquer string, é a senha digitada no painel)

## 5. Buildar o tracker (SDK embarcável)

```powershell
pnpm build:tracker
```

Gera `apps/tracker/dist/tracker.js` (minificado) + relatório de tamanho
gzip no console (meta: < 20 KB gzip). Para checar o tamanho isoladamente:

```powershell
pnpm --filter @rtanalytics/tracker size
```

## 6. Gerar eventos de teste

Com `ingest`, `dashboard-api`, `workers` e `dashboard-web` rodando, e o
tracker já buildado (passo 5):

1. Abra `examples/demo-site/index.html` diretamente no navegador (duplo
   clique ou `start examples\demo-site\index.html` no PowerShell).
2. Abra `http://localhost:5173` (dashboard-web) em outra aba.
3. Interaja com a demo page — o pageview inicial e os heartbeats a cada 15s
   devem aparecer imediatamente no dashboard (contador "online" e lista de
   eventos ao vivo), sem refresh.

Observação: o `demo-site/index.html` referencia `tracker.js` via caminho
relativo ao filesystem (`../../apps/tracker/dist/tracker.js`), então abrir o
arquivo direto do disco (`file://`) funciona para este teste manual. Para um
teste mais realista sirva a pasta `examples/demo-site` com qualquer servidor
estático (ex.: `npx serve examples/demo-site`).

## 7. Pontos pendentes / simplificações desta fase (ver relatório da tarefa)

- Sem enriquecimento de geo-IP/user-agent no `ingest` ainda — colunas
  `country`, `city`, `device`, `browser`, `os` na tabela `events` ficam
  `NULL` por enquanto.
- Sem autenticação JWT no `dashboard-api` (placeholder comentado no código).
- Tracker usa JSON (não MessagePack) — otimização futura, comentada no
  código-fonte.
- `packages/protocol` e `packages/shared-types` precisam ser buildados
  (`pnpm -r build`) antes de rodar `ingest`/`dashboard-api`/`workers` em
  modo dev, pois são consumidos como pacotes de workspace compilados.
