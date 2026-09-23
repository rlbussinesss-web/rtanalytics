import { useCallback, useEffect, useState } from "react";
import {
  Check,
  CircleAlert,
  Copy,
  Loader,
  RefreshCw,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { API_BASE_URL, getToken } from "./token";

interface Project {
  siteId: string;
  name: string;
  domain: string | null;
  conversionPath: string | null;
  discovered: boolean;
  sessions7d: number;
  lastSeen: string | null;
}

type Platform =
  | "wordpress"
  | "woocommerce"
  | "shopify"
  | "gtm"
  | "html"
  | "react"
  | "nextjs"
  | "other";

const TRACKER_URL =
  (import.meta.env.VITE_TRACKER_URL as string | undefined) ??
  "https://rtanalytics.vercel.app/tracker.js";
const INGEST_URL =
  (import.meta.env.VITE_INGEST_URL as string | undefined) ??
  "wss://rta-ingest.duckdns.org";
const CHECK_MS = 4000;

const PLATFORMS: { id: Platform; label: string; icon: string }[] = [
  { id: "wordpress", label: "WordPress", icon: "🅦" },
  { id: "woocommerce", label: "WooCommerce", icon: "🛒" },
  { id: "shopify", label: "Shopify", icon: "🟢" },
  { id: "gtm", label: "Google Tag Manager", icon: "🏷" },
  { id: "html", label: "Site HTML", icon: "🌐" },
  { id: "react", label: "React / Vite", icon: "⚛" },
  { id: "nextjs", label: "Next.js", icon: "▲" },
  { id: "other", label: "Outra plataforma", icon: "✦" },
];

function buildSnippet(siteId: string, conversionPath: string): string {
  const conv = conversionPath.trim();
  const convAttr = conv
    ? `\n  data-conversion-paths="conversao:${conv}"`
    : "";
  return `<script async src="${TRACKER_URL}"\n  data-site-id="${siteId}"\n  data-ingest-url="${INGEST_URL}"${convAttr}></script>`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${getToken() ?? ""}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return `há ${diffSec}s`;
  if (diffSec < 3600) return `há ${Math.round(diffSec / 60)}min`;
  return d.toLocaleString("pt-BR");
}

/* ---------- Sub-components ---------- */

function SnippetBlock({
  snippet,
  copied,
  onCopy,
}: {
  snippet: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="inst-snippet-wrap">
      <div className="inst-code">
        <pre>{snippet}</pre>
        <button className="btn btn-primary btn-sm inst-copy" onClick={onCopy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
          {copied ? "Copiado!" : "Copiar código"}
        </button>
      </div>
      <p className="inst-snippet-note">
        ⚠️ Não altere este código — ele já contém as informações exclusivas do
        seu projeto.
      </p>
    </div>
  );
}

function PlatformGuide({
  platform,
  snippet,
  copied,
  onCopy,
}: {
  platform: Platform;
  snippet: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const sb = <SnippetBlock snippet={snippet} copied={copied} onCopy={onCopy} />;
  switch (platform) {
    case "wordpress":
      return (
        <div className="inst-guide">
          <h4>Como instalar no WordPress</h4>
          <p>A forma mais segura é usar um plugin de inserção de código.</p>
          <ol>
            <li>No painel do WordPress, vá em <strong>Plugins → Adicionar novo</strong>.</li>
            <li>Pesquise por <strong>"WPCode"</strong> ou <strong>"Insert Headers and Footers"</strong>. Instale e ative.</li>
            <li>Vá em <strong>Code Snippets → Header & Footer</strong>.</li>
            <li>Cole o código abaixo no campo <strong>"Footer"</strong> ou <strong>"Before &lt;/body&gt;"</strong>.</li>
            <li>Clique em <strong>Salvar</strong>.</li>
            <li>Volte aqui e clique em <strong>"Verificar instalação"</strong>.</li>
          </ol>
          {sb}
        </div>
      );
    case "woocommerce":
      return (
        <div className="inst-guide">
          <h4>Como instalar no WooCommerce</h4>
          <p>WooCommerce roda dentro do WordPress, então o processo é o mesmo.</p>
          <ol>
            <li>Siga os mesmos passos do WordPress acima (use o plugin <strong>WPCode</strong>).</li>
            <li>O código vale para <strong>todas as páginas</strong> da loja, incluindo checkout.</li>
            <li>Configure o caminho de conversão na etapa seguinte.</li>
          </ol>
          {sb}
        </div>
      );
    case "shopify":
      return (
        <div className="inst-guide">
          <h4>Como instalar no Shopify</h4>
          <ol>
            <li>No admin do Shopify, vá em <strong>Loja virtual → Temas</strong>.</li>
            <li>No tema ativo, clique em <strong>"⋯" → Editar código</strong>.</li>
            <li>Procure o arquivo <code>layout/theme.liquid</code>.</li>
            <li>Role até o final e localize <code>&lt;/body&gt;</code>.</li>
            <li>Cole o código <strong>logo acima</strong> dessa linha.</li>
            <li>Clique em <strong>Salvar</strong>.</li>
            <li>Volte ao Pathora e verifique.</li>
          </ol>
          {sb}
        </div>
      );
    case "gtm":
      return (
        <div className="inst-guide">
          <h4>Como instalar via Google Tag Manager</h4>
          <ol>
            <li>Abra o GTM e selecione o container do seu site.</li>
            <li>Vá em <strong>Tags → Nova tag</strong>.</li>
            <li>Em Configuração, escolha <strong>"HTML personalizado"</strong>.</li>
            <li>Cole o código abaixo.</li>
            <li>Em Acionadores, selecione <strong>"All Pages"</strong>.</li>
            <li>Clique em <strong>Salvar</strong>.</li>
            <li>Use <strong>"Visualizar"</strong> para testar.</li>
            <li>Se funcionar, clique em <strong>"Enviar" → Publicar</strong>.</li>
            <li>Volte ao Pathora e verifique.</li>
          </ol>
          {sb}
        </div>
      );
    case "html":
      return (
        <div className="inst-guide">
          <h4>Como instalar em um site HTML</h4>
          <p>Abra o arquivo HTML principal e cole o código logo antes de <code>&lt;/body&gt;</code>.</p>
          <div className="inst-html-example">
            <pre>{`<html>\n<head>...</head>\n<body>\n  ... conteúdo do site ...\n\n  ← COLE O CÓDIGO AQUI\n</body>\n</html>`}</pre>
          </div>
          <p>Se o site tem várias páginas, coloque em <strong>todas</strong> elas.</p>
          {sb}
        </div>
      );
    case "react":
      return (
        <div className="inst-guide">
          <h4>Como instalar em React / Vite</h4>
          <p>Em SPAs, carregue o tracker <strong>uma única vez</strong> no componente raiz.</p>
          <ol>
            <li>Abra <code>index.html</code> na raiz do projeto.</li>
            <li>Cole o código antes de <code>&lt;/body&gt;</code>.</li>
          </ol>
          {sb}
          <details className="inst-advanced">
            <summary>Modo avançado: integração via componente</summary>
            <pre>{`// App.tsx\nuseEffect(() => {\n  const s = document.createElement('script');\n  s.src = '${TRACKER_URL}';\n  s.async = true;\n  s.dataset.siteId = '${snippet.match(/data-site-id="([^"]+)"/)?.[1] ?? "SEU_SITE_ID"}';\n  s.dataset.ingestUrl = '${INGEST_URL}';\n  document.body.appendChild(s);\n}, []);`}</pre>
          </details>
        </div>
      );
    case "nextjs":
      return (
        <div className="inst-guide">
          <h4>Como instalar em Next.js</h4>
          <p>Use o componente <code>Script</code> do Next.js no layout raiz.</p>
          <pre className="inst-code-block">{`import Script from 'next/script';\n\n<Script\n  src="${TRACKER_URL}"\n  strategy="afterInteractive"\n  data-site-id="${snippet.match(/data-site-id="([^"]+)"/)?.[1] ?? "SEU_SITE_ID"}"\n  data-ingest-url="${INGEST_URL}"\n/>`}</pre>
          {sb}
        </div>
      );
    default:
      return (
        <div className="inst-guide">
          <h4>Instruções gerais</h4>
          <p>Cole o código abaixo logo antes de <code>&lt;/body&gt;</code> no HTML do seu site.</p>
          {sb}
        </div>
      );
  }
}

function DiagnosticPanel({
  project,
  installed,
  checking,
  onRecheck,
}: {
  project: Project | undefined;
  installed: boolean;
  checking: boolean;
  onRecheck: () => void;
}) {
  const checks = [
    { label: "Projeto criado", ok: Boolean(project), hint: "O projeto existe no Pathora." },
    { label: "Domínio configurado", ok: Boolean(project?.domain), hint: project?.domain ? project.domain : "Configure o domínio na aba Projetos." },
    { label: "API Pathora", ok: true, hint: "Conexão com a API funcionando." },
    { label: "Tracker detectado", ok: installed, hint: installed ? `Último evento: ${formatTime(project?.lastSeen)}` : "Nenhum evento recebido ainda." },
  ];
  return (
    <div className="inst-diag">
      <div className="inst-diag-head">
        <h4><ShieldCheck size={15} /> Diagnóstico</h4>
        <button className="btn btn-ghost btn-sm" onClick={onRecheck} disabled={checking}>
          {checking ? <Loader size={13} className="inst-spin" /> : <RefreshCw size={13} />} Verificar agora
        </button>
      </div>
      <ul className="inst-diag-list">
        {checks.map((c) => (
          <li key={c.label} className={c.ok ? "ok" : "pending"}>
            {c.ok ? <Check size={14} /> : <Loader size={14} className="inst-spin" />}
            <span><b>{c.label}</b><small>{c.hint}</small></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Main component ---------- */

export function InstallPanel({ siteId }: { siteId: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState(siteId);
  const [conversionPath, setConversionPath] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const [copied, setCopied] = useState(false);
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ projects: Project[] }>("/api/projects");
      setProjects(d.projects);
      const p = d.projects.find((x) => x.siteId === selected);
      if (p) {
        setSavedPath(p.conversionPath ?? "");
        setConversionPath((cur) => cur || p.conversionPath || "");
      }
    } catch { /* keep current state */ }
  }, [selected]);

  useEffect(() => {
    void load();
    const t = setInterval(load, CHECK_MS);
    return () => clearInterval(t);
  }, [load]);

  const project = projects.find((p) => p.siteId === selected);
  const installed = Boolean(project?.lastSeen);
  const snippet = buildSnippet(selected, conversionPath);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* clipboard blocked */ }
  }

  async function savePath() {
    try {
      await api(`/api/projects/${encodeURIComponent(selected)}`, {
        method: "PATCH",
        body: JSON.stringify({ conversionPath }),
      });
      setSavedPath(conversionPath);
    } catch { /* saving only remembers it */ }
  }

  function recheck() {
    setChecking(true);
    void load().finally(() => setChecking(false));
  }

  return (
    <div className="inst">
      <header className="inst-head">
        <h2>Instalar Pathora</h2>
        <p>O Pathora acompanha visitantes, cliques, scroll e conversões do seu site. Para começar, basta colocar um pequeno código no seu site — ele não altera nada visualmente. Este assistente te guia passo a passo.</p>
      </header>

      {projects.length > 1 && (
        <label className="inst-picker">
          <span>Projeto</span>
          <select className="input" value={selected} onChange={(e) => { setSelected(e.target.value); setConversionPath(""); setPlatform(null); }}>
            {projects.map((p) => (<option key={p.siteId} value={p.siteId}>{p.name}</option>))}
          </select>
        </label>
      )}

      {installed && (
        <div className="inst-success-banner">
          <Check size={20} />
          <div>
            <b>Pathora conectado e recebendo dados!</b>
            <span>{project?.sessions7d ?? 0} sessão(ões) nos últimos 7 dias · Último evento: {formatTime(project?.lastSeen)}</span>
          </div>
        </div>
      )}

      <ol className="inst-steps">
        <li>
          <h3>Escolha a plataforma do seu site</h3>
          <p>Selecione como o seu site foi feito. Mostraremos instruções exatas para o seu caso.</p>
          <div className="inst-platforms">
            {PLATFORMS.map((pl) => (
              <button key={pl.id} className={`inst-plat${platform === pl.id ? " active" : ""}`} onClick={() => setPlatform(pl.id)}>
                <span className="inst-plat-icon">{pl.icon}</span>
                <span className="inst-plat-label">{pl.label}</span>
              </button>
            ))}
          </div>
        </li>

        <li>
          <h3>Copie o código e cole no seu site</h3>
          {!platform ? (
            <p className="inst-placeholder">↑ Escolha uma plataforma acima para ver as instruções detalhadas.</p>
          ) : (
            <PlatformGuide platform={platform} snippet={snippet} copied={copied} onCopy={copy} />
          )}
        </li>

        <li>
          <h3>Diga o que conta como venda</h3>
          <p>Informe o endereço da página que só aparece quando a pessoa converte — a tela de pagamento, de Pix gerado ou de obrigado.</p>
          <div className="inst-conv">
            <input className="input" value={conversionPath} onChange={(e) => setConversionPath(e.target.value)} placeholder="/pagamento" />
            <button className="btn btn-ghost btn-sm" onClick={savePath} disabled={conversionPath === savedPath}>
              {conversionPath === savedPath ? "Salvo" : "Salvar"}
            </button>
          </div>
          <p className="inst-note">Digite só o final do endereço. Se a página é <code>seusite.com/pagamento</code>, escreva <code>/pagamento</code>.</p>
        </li>

        <li>
          <h3>Publique e verifique</h3>
          <p>Salve e publique o site, depois abra a página no navegador. Assim que alguém carregar, o Pathora avisa aqui.</p>
          <div className={`inst-status${installed ? " ok" : ""}`}>
            {installed ? (
              <><Zap size={18} /><div><b>Instalado e recebendo dados</b><span>Pode fechar esta página. Os dados já estão aparecendo nas outras abas.</span></div></>
            ) : (
              <><Loader size={18} className="inst-spin" /><div><b>Aguardando o primeiro acesso…</b><span>Esta tela verifica automaticamente a cada {CHECK_MS / 1000}s. Abra seu site no navegador para acelerar.</span></div></>
            )}
          </div>
          <DiagnosticPanel project={project} installed={installed} checking={checking} onRecheck={recheck} />
        </li>
      </ol>

      {!installed && (
        <section className="inst-help">
          <h3><CircleAlert size={15} /> Não funcionou? Confira estas 5 coisas:</h3>
          <ul>
            <li>Você <strong>publicou/salvou</strong> as alterações? Em muitas plataformas, salvar ≠ publicar.</li>
            <li>Colou o código <strong>inteiro</strong>? Verifique se não faltou nenhuma parte.</li>
            <li>O código está em <strong>todas as páginas</strong> que você quer monitorar?</li>
            <li>O <strong>domínio</strong> informado no projeto está correto?</li>
            <li>Cache ou CDN pode estar mostrando uma versão antiga. Tente limpar o cache.</li>
        </ul>
      </section>
    )}
  </div>
);
}