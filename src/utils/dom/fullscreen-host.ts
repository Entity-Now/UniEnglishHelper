/**
 * Mounts an injected overlay element into the active Fullscreen Top-Layer
 * container when fullscreen is active, or `hostDoc.documentElement` otherwise,
 * and automatically reparents it across `fullscreenchange` transitions.
 */
export function mountFullscreenAwareHost(
  host: HTMLElement,
  hostDoc: Document = document,
): () => void {
  const getTarget = (): HTMLElement =>
    (hostDoc.fullscreenElement as HTMLElement | null) ??
    hostDoc.documentElement;

  const syncParent = () => {
    if (!host.isConnected) return;
    const target = getTarget();
    if (host.parentElement !== target) {
      target.appendChild(host);
    }
  };

  getTarget().appendChild(host);
  hostDoc.addEventListener('fullscreenchange', syncParent);

  return () => {
    hostDoc.removeEventListener('fullscreenchange', syncParent);
  };
}
