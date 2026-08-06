/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DASHBOARD_API_URL?: string;
  readonly VITE_DASHBOARD_API_WS_URL?: string;
  readonly VITE_SITE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
