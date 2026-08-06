# Registrar pagamento confirmado (conversão de verdade)

O RTAnalytics roda no navegador, então **não consegue saber sozinho que um Pix
foi pago** — o visitante pode fechar a aba e pagar depois. A fonte de verdade é
o seu sistema de pagamento. Por isso o pagamento confirmado é reportado por uma
chamada **servidor-a-servidor**, que funciona em qualquer situação.

São dois passos:

## 1. No navegador — guarde o identificador do visitante ao gerar o Pix

Quando o visitante gera o Pix, leia os identificadores do RTAnalytics e mande
junto do pedido para a sua API:

```js
const { visitorId, sessionId } = window.rta.identify();

await fetch("https://sua-api/gerar-pix", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    valor: 20.0,
    // ... dados do pedido ...
    rta: { visitorId, sessionId },   // <- guarde isso junto do pedido
  }),
});
```

A sua API salva `visitorId` e `sessionId` na linha do pedido/cobrança.

## 2. No servidor — quando o pagamento confirmar, avise o RTAnalytics

No ponto do seu sistema em que o pagamento é **confirmado** (callback do
gateway, verificação de status, etc.), chame o endpoint do RTAnalytics com a
chave secreta:

```
POST https://ingest-production-e15e.up.railway.app/api/server-event
Headers:
  Content-Type: application/json
  X-RTA-Key: <SUA_CHAVE_SECRETA>          # variável SERVER_INGEST_KEY do ingest
Body:
{
  "siteId": "meu-site",
  "visitorId": "<o visitorId salvo com o pedido>",
  "sessionId": "<o sessionId salvo com o pedido>",
  "name": "pagamento_confirmado",
  "value": 20.0
}
```

Resposta `{"ok": true}`. A conversão entra imediatamente nas métricas, no funil
e no feed ao vivo, atrelada à sessão certa (com replay, país, dispositivo).

### Exemplo em Node.js (dentro do seu handler de pagamento confirmado)

```js
await fetch("https://ingest-production-e15e.up.railway.app/api/server-event", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-RTA-Key": process.env.RTA_SERVER_KEY,
  },
  body: JSON.stringify({
    siteId: "meu-site",
    visitorId: pedido.rta_visitor_id,
    sessionId: pedido.rta_session_id,
    name: "pagamento_confirmado",
    value: pedido.valor,
  }),
});
```

## Dica: separe "gerou Pix" de "pagou"

- No navegador, quando o QR aparece: `window.rta.track('pix_gerado', 20)`.
- No servidor, quando confirma: `name: "pagamento_confirmado"`.

A diferença entre os dois é a sua **taxa de pagamento** — quantos que geraram
realmente pagaram. Monte um funil com as duas etapas para ver isso.

## Segurança

- A chave (`SERVER_INGEST_KEY`) fica **só no seu servidor**, nunca no navegador.
- Se vazar, gere outra e troque a variável no serviço `ingest` (Railway).
- O endpoint só aceita `siteId` que esteja em `ALLOWED_SITE_IDS`.
