/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** OAuth client ID for Google Sheets sync. Safe to expose in a browser app. */
  readonly VITE_GOOGLE_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
