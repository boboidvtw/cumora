/** Self-hosted builds have no Cumora Cloud to upgrade to, so they can hide
 * the "upgrade to Pro" entries (`VITE_CUMORA_HIDE_CLOUD_UPSELL=1` at build
 * time). Unset keeps the hosted behaviour. */
export function cloudUpsellEnabled(): boolean {
  const raw = import.meta.env?.VITE_CUMORA_HIDE_CLOUD_UPSELL
  return !(raw === '1' || raw === 'true')
}
