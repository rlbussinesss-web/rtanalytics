import { useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, Copy, Loader } from "lucide-react";
import { API_BASE_URL, getToken } from "./token";

/**
 * Installation.
 *
 * Onboarding is where this kind of product usually loses people: the snippet is
 * shown once, in a corner, and then the user is left staring at an empty
 * dashboard with no way to tell whether they pasted it correctly. So this page
 * does three things a code block alone cannot — it hands over a snippet that is
 * already correct for *this* offer, explains where to paste it in plain
 * language, and then watches the pipeline and says out loud when the first
 * event arrives.
 */

interface Project {
  siteId: string;
  name: string;
  domain: string | null;
  conversionPath: string | null;
  discovered: boolean;
  sessions7d: number;
  lastSeen: string | null;
}

const TRACKER_URL =
  (import.meta.env.VITE_TRACKER_URL as string | undefined) ??
  "https://pathora.vercel.app/tracker.js";
const INGEST_URL =
  (import.meta.env.VITE_INGEST_URL as string | undefined) ??
  "wss://rta-ingest.duckdns.org";

/** How often the page re-checks whether data has started arriving. */
const CHECK_MS = 5000;

function buildSnippet(siteId: string, conversionPath: string): string {
  const conv = conversionPath.trim();
  const convAttr = conv ? `\n  data-conversion-paths="conversao:${conv}"` : "";
  return `<script async src="${TRACKER_URL}"
  data-site-id="${siteId}"
  data-ingest-url="${INGEST_URL}"${convAttr}></script>`;
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

export function InstallPanel({ siteId }: { siteId: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState(siteId);
  const [conversionPath, setConversionPath] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ projects: Project[] }>("/api/projects");
      setProjects(d.projects);
      const p = d.projects.find((x) => x.siteId === selected);
      if (p) {
        setSavedPath(p.conversionPath ?? "");
        setConversionPath((cur) => (cur ? cur : p.conversionPath ?? ""));
      }
    } catch {
      /* leave whatever is on screen */
    }
  }, [selected]);

  useEffect(() => {
    void load();
    // Poll so the confirmation appears on its own the moment the first visitor
    // loads the page — the user should not have to guess and refresh.
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
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the code is on screen to select by hand */
    }
  }

  async function savePath() {
    try {
      await api(`/api/projects/${encodeURIComponent(selected)}`, {
        method: "PATCH",
        body: JSON.stringify({ conversionPath }),
      });
      setSavedPath(conversionPath);
    } catch {
      /* the snippet on screen is still correct; saving only remembers it */
    }
  }

  return (
    <div className="inst">
      <header className="inst-head">
        <h2>Instalação</h2>
        <p>
          Cole um código no seu site e o Pathora começa a acompanhar os visitantes.
          Leva cerca de dois minutos.
        </p>
      </header>

      {projects.length > 1 && (
        <label className="inst-picker">
          <span>Projeto</span>
          <select
            className="input"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setConversionPath("");
            }}
          >
            {projects.map((p) => (
              <option key={p.siteId} value={p.siteId}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <ol className="inst-steps">
        <li>
          <h3>Copie o código</h3>
          <p>
            Este código é exclusivo deste projeto — ele carrega o rastreador e diz a qual
            oferta os dados pertencem.
          </p>
          <div className="inst-code">
            <pre>{snippet}</pre>
            <button className="btn btn-primary btn-sm inst-copy" onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copiado" : "Copiar código"}
            </button>
          </div>
        </li>

        <li>
          <h3>Cole no seu site</h3>
          <p>
            Cole logo antes da linha <code>&lt;/body&gt;</code>, no final do HTML. Se a sua
            página tem várias telas (home, checkout, obrigado), o código precisa estar em{" "}
            <strong>todas</strong> — normalmente basta colocar no arquivo de layout, que é
            compartilhado.
          </p>
          <div className="inst-where">
            <div>
              <b>Site em HTML</b>
              <span>
                Abra o arquivo <code>index.html</code> e cole antes de <code>&lt;/body&gt;</code>.
              </span>
            </div>
            <div>
              <b>Next.js / React</b>
              <span>
                Cole no arquivo de layout (<code>layout.tsx</code> ou <code>_app.tsx</code>), assim
                vale para todas as páginas.
              </span>
            </div>
            <div>
              <b>WordPress</b>
              <span>
                Aparência → Editor de temas → <code>footer.php</code>, antes de{" "}
                <code>&lt;/body&gt;</code>. Ou use um plugin de inserir código no rodapé.
              </span>
            </div>
            <div>
              <b>Shopify</b>
              <span>
                Loja virtual → Temas → Editar código → <code>theme.liquid</code>, antes de{" "}
                <code>&lt;/body&gt;</code>.
              </span>
            </div>
          </div>
        </li>

        <li>
          <h3>Diga o que conta como venda</h3>
          <p>
            Informe o endereço da página que só aparece quando a pessoa converte — a tela de
            pagamento, de Pix gerado ou de obrigado. É assim que o Pathora sabe quem comprou.
          </p>
          <div className="inst-conv">
            <input
              className="input"
              value={conversionPath}
              onChange={(e) => setConversionPath(e.target.value)}
              placeholder="/pagamento"
            />
            <button
              className="btn btn-ghost btn-sm"
              onClick={savePath}
              disabled={conversionPath === savedPath}
            >
              {conversionPath === savedPath ? "Salvo" : "Salvar"}
            </button>
          </div>
          <p className="inst-note">
            Digite só o final do endereço, depois do domínio. Se a sua página de pagamento é{" "}
            <code>seusite.com/pagamento</code>, escreva <code>/pagamento</code>. Ao salvar, o
            código acima já sai com essa informação.
          </p>
        </li>

        <li>
          <h3>Publique e abra a página</h3>
          <p>
            Salve e publique o site, depois abra a página no navegador. Assim que a primeira
            pessoa (você serve) carregar, aparece a confirmação aqui embaixo — sem precisar
            atualizar esta tela.
          </p>

          <div className={`inst-status${installed ? " ok" : ""}`}>
            {installed ? (
              <>
                <Check size={18} />
                <div>
                  <b>Instalado e recebendo dados</b>
                  <span>
                    {project?.sessions7d ?? 0} sessão(ões) nos últimos 7 dias. Pode fechar esta
                    página.
                  </span>
                </div>
              </>
            ) : (
              <>
                <Loader size={18} className="inst-spin" />
                <div>
                  <b>Aguardando o primeiro acesso…</b>
                  <span>Esta tela avisa sozinha quando os dados chegarem.</span>
                </div>
              </>
            )}
          </div>
        </li>
      </ol>

      <section className="inst-help">
        <h3>
          <CircleAlert size={15} /> Não apareceu nada?
        </h3>
        <ul>
          <li>
            Confirme que você <strong>publicou</strong> o site depois de colar — em muitas
            hospedagens, salvar não é o mesmo que publicar.
          </li>
          <li>
            Veja se o código está mesmo na página: abra o site, clique com o botão direito →
            "Exibir código-fonte" e procure por <code>{selected}</code>.
          </li>
          <li>
            Bloqueadores de anúncio no <em>seu</em> navegador podem impedir o envio. Teste numa
            aba anônima ou pelo celular.
          </li>
          <li>
            Se você copiou o código de outro projeto, os dados vão para lá. Confira se a chave
            no site é <code>{selected}</code>.
          </li>
        </ul>
      </section>
    </div>
  );
}
