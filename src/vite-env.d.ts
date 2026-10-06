/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CUMORA_API_BASE?: string
  readonly VITE_CUMORA_DEV_API_TARGET?: string
  /** First-run UI locale for this build (e.g. `zh-TW`); a stored choice still wins. */
  readonly VITE_CUMORA_DEFAULT_LOCALE?: string
  /** `1` hides the Cumora Cloud "upgrade to Pro" entries (self-hosted builds). */
  readonly VITE_CUMORA_HIDE_CLOUD_UPSELL?: string
  readonly VITE_PUBLIC_POSTHOG_KEY?: string
  readonly VITE_PUBLIC_POSTHOG_HOST?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
