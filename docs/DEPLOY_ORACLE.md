# Subir o RTA numa máquina grátis da Oracle

Guia completo, do zero. Não precisa saber Linux — é copiar, colar e esperar.

**O que você vai ter no final:** o sistema rodando 24h numa máquina na nuvem da
Oracle, de graça e para sempre. Seu PC não participa: pode desligar.

**Tempo:** ~40 minutos, sendo a maior parte espera.

**Custo:** R$ 0. A Oracle pede cartão só para confirmar que você é uma pessoa —
a camada "Always Free" não cobra. Ainda assim, no passo 1 a gente configura um
alerta de gasto, porque confiar sem verificar é como se perde dinheiro.

---

## 1. Criar a conta na Oracle

1. Acesse **cloud.oracle.com** → *Start for free*.
2. Escolha o país **Brasil** e a região **South America East (São Paulo)** —
   quanto mais perto dos seus visitantes, mais rápido.
   > A região **não pode ser trocada depois**. Se São Paulo não aparecer,
   > escolha Vinhedo (Brazil Southeast).
3. Preencha os dados e valide o cartão. **Não é cobrado.**
4. Depois de entrar, procure **Billing → Budgets** e crie um orçamento de
   **US$ 1** com alerta por e-mail. Se algo sair do gratuito, você fica sabendo
   no mesmo dia em vez de no fim do mês.

---

## 2. Criar a máquina

1. Menu (☰) → **Compute → Instances → Create instance**.
2. **Nome:** `rtanalytics`
3. Em **Image and shape** → *Edit* → **Change shape**:
   - Série: **Ampere** (ARM)
   - Shape: **VM.Standard.A1.Flex**
   - **4 OCPUs** e **24 GB** de memória
   > Isso é o máximo do plano gratuito. Se der erro de capacidade
   > ("Out of host capacity"), tente **1 OCPU / 6 GB**, ou troque a
   > *Availability Domain* (AD-1, AD-2, AD-3) e tente de novo. É comum.
4. **Image:** Ubuntu 22.04 (ou 24.04).
5. Em **Add SSH keys**, escolha **Generate a key pair for me** e clique em
   **Save private key**. Guarde esse arquivo — é a chave da sua máquina.
6. **Create**. Em ~1 minuto ela liga. Anote o **Public IP address**.

---

## 3. Abrir as portas 80 e 443

Por padrão a Oracle bloqueia tudo. Sem isso, ninguém alcança o servidor.

1. Na página da instância, clique na **Subnet** → **Default Security List**.
2. **Add Ingress Rules**, e crie duas regras:

| Source CIDR | IP Protocol | Destination Port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

3. Deixe **Stateless desmarcado**.

---

## 4. Criar os dois endereços grátis (DuckDNS)

O navegador exige HTTPS, e HTTPS exige um endereço de verdade — não dá para
usar só o número do IP.

1. Acesse **duckdns.org** e entre com Google/GitHub.
2. Crie **dois** subdomínios, por exemplo:
   - `rta-ingest`
   - `rta-api`
3. Em cada um, coloque o **IP público da máquina** no campo *current ip* e
   clique em **update ip**.

Seus endereços ficam `rta-ingest.duckdns.org` e `rta-api.duckdns.org`.

---

## 5. Entrar na máquina

No seu PC, abra o terminal na pasta onde salvou a chave:

```bash
chmod 600 ssh-key-*.key
ssh -i ssh-key-*.key ubuntu@SEU_IP_PUBLICO
```

> No Windows, use o **PowerShell**. Se reclamar de permissão da chave, clique
> com o botão direito no arquivo → Propriedades → Segurança → deixe só o seu
> usuário com acesso.

---

## 6. Instalar o Docker

Cole tudo de uma vez:

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER
```

Saia e entre de novo (`exit`, depois o `ssh` outra vez) para o Docker
funcionar sem `sudo`.

A Oracle vem com um firewall interno que bloqueia as portas mesmo depois do
passo 3. Libere:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

---

## 7. Baixar o projeto e configurar

```bash
git clone https://github.com/rlbussinesss-web/rtanalytics.git
cd rtanalytics/infra
cp .env.prod.example .env
nano .env
```

No editor, troque:

- `INGEST_DOMAIN` e `API_DOMAIN` pelos seus dois endereços do DuckDNS
- `POSTGRES_PASSWORD` por uma senha longa qualquer (ninguém digita ela)
- `DASHBOARD_TOKEN` — cole a senha do painel (a mesma de hoje, se quiser manter)
- `CORS_ORIGINS` — já vem com os endereços do painel

Salve com **Ctrl+O**, Enter, e saia com **Ctrl+X**.

---

## 8. Subir tudo

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

A primeira vez demora ~5 minutos (ele compila o projeto). Depois:

```bash
docker compose -f docker-compose.prod.yml ps
```

Todos devem aparecer como **running**. Para ver se está saudável:

```bash
curl -s https://rta-api.duckdns.org/healthz
curl -s https://rta-ingest.duckdns.org/healthz
```

Os dois devem responder `{"status":"ok"}`. Se der erro de certificado nos
primeiros 30 segundos, é normal — o Caddy ainda está emitindo. Espere e tente
de novo.

---

## 9. Apontar o painel e o tracker para a máquina nova

Isso é feito no seu PC, no projeto (não no servidor). Peça para eu fazer, ou:

```bash
VITE_DASHBOARD_API_URL="https://rta-api.duckdns.org" \
VITE_DASHBOARD_API_WS_URL="wss://rta-api.duckdns.org" \
VITE_INGEST_URL="wss://rta-ingest.duckdns.org" \
VITE_SITE_ID="meu-site" \
pnpm --filter @rtanalytics/dashboard-web build
```

E depois publicar na Vercel como de costume.

Por último, **troque o endereço no script do seu site** (`data-ingest-url`)
para `wss://rta-ingest.duckdns.org`. A aba **Instalação** do painel já mostra o
código atualizado para copiar.

---

## Manutenção

**Ver o que está acontecendo:**
```bash
cd ~/rtanalytics/infra
docker compose -f docker-compose.prod.yml logs -f --tail 50
```

**Atualizar quando eu mexer no código:**
```bash
cd ~/rtanalytics && git pull
cd infra && docker compose -f docker-compose.prod.yml up -d --build
```

**Backup do banco** (rode de vez em quando; guarde o arquivo fora do servidor):
```bash
docker exec rta-postgres pg_dump -U rtanalytics rtanalytics | gzip > ~/backup-$(date +%F).sql.gz
```

---

## Se der problema

| Sintoma | Causa provável |
|---|---|
| `curl` não responde nada | Portas fechadas — refaça os passos 3 e 6 |
| Erro de certificado que não passa | O DuckDNS não está apontando para o IP certo |
| "Out of host capacity" ao criar a VM | Normal na Oracle; tente outra Availability Domain ou menos CPUs |
| Painel abre mas sem dados | `CORS_ORIGINS` no `.env` não inclui o endereço do painel |
| Site não coleta | O `data-ingest-url` no site ainda aponta para o Railway antigo |

**O que acontece se a máquina reiniciar:** tudo sobe sozinho
(`restart: unless-stopped`). Você não precisa fazer nada.
