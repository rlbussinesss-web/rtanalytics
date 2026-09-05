import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Plus, Settings, Trash2 } from "lucide-react";
import { API_BASE_URL, getToken } from "./token";

/**
 * Projects: one card per offer.
 *
 * The entry point for someone running many landing pages. A project is created
 * *before* it has traffic — that is the whole point, since the moment you need
 * the tracking snippet is while you are installing it, and a site discovered
 * from the event log cannot exist yet.
 */

interface Project {
  siteId: string;
  name: string;
  domain: string | null;
  createdAt: string | null;
  discovered: boolean;
  sessions7d: number;
  conversions7d: number;
  lastSeen: string | null;
}

/** Where the tracker and ingest live, overridable per build. */
const TRACKER_URL =
  (import.meta.env.VITE_TRACKER_URL as string | undefined) ??
  "https://rtanalytics.vercel.app/tracker.js";
const INGEST_URL =
  (import.meta.env.VITE_INGEST_URL as string | undefined) ??
  "wss://ingest-production-e15e.up.railway.app";

function snippetFor(siteId: string): string {
  return `<script async src="${TRACKER_URL}"
  data-site-id="${siteId}"
  data-ingest-url="${INGEST_URL}"
  data-conversion-paths="pix_gerado:/pagamento"></script>`;
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

export function ProjectsPanel({
  currentSiteId,
  onOpen,
  onInstall,
}: {
  currentSiteId: string;
  onOpen: (siteId: string) => void;
  onInstall: (siteId: string) => void;
}) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which project's install snippet is open. */
  const [showSnippet, setShowSnippet] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ projects: Project[] }>("/api/projects");
      setProjects(d.projects);
    } catch {
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api<{ project: Project }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name, domain }),
      });
      setName("");
      setDomain("");
      setCreating(false);
      await load();
      // Straight to the snippet: creating a project without showing what to
      // paste would leave the job half done.
      setShowSnippet(d.project.siteId);
    } catch {
      setError("Não foi possível criar o projeto.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Project) {
    if (!confirm(`Remover "${p.name}"? Os dados já coletados são mantidos.`)) return;
    try {
      await api(`/api/projects/${encodeURIComponent(p.siteId)}`, { method: "DELETE" });
      await load();
    } catch {
      setError("Não foi possível remover o projeto.");
    }
  }

  async function adopt(p: Project) {
    const newName = prompt("Nome deste projeto:", p.name);
    if (!newName?.trim()) return;
    try {
      // A discovered site has no row yet. Naming it must adopt its existing
      // key, never mint a new one — that key is already live in a page.
      if (p.discovered) {
        await api("/api/projects", {
          method: "POST",
          body: JSON.stringify({ name: newName, domain: p.domain ?? undefined, siteId: p.siteId }),
        });
      } else {
        await api(`/api/projects/${encodeURIComponent(p.siteId)}`, {
          method: "PATCH",
          body: JSON.stringify({ name: newName, domain: p.domain ?? undefined }),
        });
      }
      await load();
    } catch {
      setError("Não foi possível renomear.");
    }
  }

  async function copySnippet(siteId: string) {
    try {
      await navigator.clipboard.writeText(snippetFor(siteId));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the snippet is on screen to copy by hand */
    }
  }

  return (
    <div>
      <div className="pj-head">
        <div>
          <h2 className="pj-title">Meus projetos</h2>
          <p className="pj-sub">Um por oferta. Crie primeiro, depois cole o script na página.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
          <Plus size={15} /> Novo projeto
        </button>
      </div>

      {error && <div className="card pj-error">{error}</div>}

      {creating && (
        <form className="card pj-form" onSubmit={submit}>
          <div className="pj-fields">
            <label>
              <span>Nome da oferta</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Recarga TIM — criativo 3"
                autoFocus
              />
            </label>
            <label>
              <span>Domínio (opcional)</span>
              <input
                className="input"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="recarga-tim-rapido.vercel.app"
              />
            </label>
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy ? "Criando…" : "Criar projeto"}
          </button>
        </form>
      )}

      {showSnippet && (
        <div className="card pj-snippet">
          <div className="pj-snippet-head">
            <b>Cole isto antes do &lt;/body&gt; da página</b>
            <div>
              <button className="btn btn-ghost btn-sm" onClick={() => copySnippet(showSnippet)}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copiado" : "Copiar"}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowSnippet(null)}>
                Fechar
              </button>
            </div>
          </div>
          <pre>{snippetFor(showSnippet)}</pre>
          <p className="pj-hint">
            Os dados aparecem assim que a primeira pessoa visitar a página. A chave{" "}
            <code>{showSnippet}</code> já está liberada para receber.
          </p>
        </div>
      )}

      {!projects && <div className="card pj-empty">carregando projetos…</div>}

      {projects && projects.length === 0 && (
        <div className="card pj-empty">
          <b>Nenhum projeto ainda</b>
          <p>Crie o primeiro para receber o script de instalação.</p>
        </div>
      )}

      <div className="pj-grid">
        {projects?.map((p) => (
          <article
            key={p.siteId}
            className={`card pj-card${p.siteId === currentSiteId ? " is-current" : ""}`}
          >
            <button className="pj-open" onClick={() => onOpen(p.siteId)}>
              <span className="pj-name">{p.name}</span>
              <span className="pj-domain">{p.domain ?? p.siteId}</span>
            </button>

            <div className="pj-stats">
              <span>
                <b>{p.sessions7d}</b> sessões · 7d
              </span>
              <span>
                <b>{p.conversions7d}</b> conversões
              </span>
              {p.discovered && <span className="pj-tag">não nomeado</span>}
            </div>

            <div className="pj-actions">
              <button title="Instruções de instalação" onClick={() => onInstall(p.siteId)}>
                <Copy size={15} />
              </button>
              <button title="Renomear" onClick={() => adopt(p)}>
                <Settings size={15} />
              </button>
              {!p.discovered && (
                <button title="Remover" className="pj-danger" onClick={() => remove(p)}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
