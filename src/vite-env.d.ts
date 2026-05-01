/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NEON_AUTH_URL: string;
  readonly VITE_CANONICAL_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
