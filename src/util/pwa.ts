// Service-worker registration for the PWA shell (see public/sw.js for the
// worker's own caching/honesty contract).
//
// Registration rules:
// - PRODUCTION BUILDS ONLY. The dev server must never be controlled: a
//   service worker caching dev assets would fight HMR and serve stale
//   modules across restarts.
// - Registration failures are silent by design: the worker is an
//   enhancement (install, offline shell, update prompt) and its absence
//   never degrades the explorer itself.
// - The script URL rides import.meta.env.BASE_URL so subpath deploys
//   (GitHub Pages, VITE_BASE=/my-block-explorer/) register the copy that
//   was deployed at their scope root.
//
// Update flow: when a freshly fetched worker finishes installing while the
// page is still controlled by the previous one, a sticky toast offers
// Reload. The click posts SKIP_WAITING to the waiting worker; the
// controllerchange that follows reloads the page once (guarded so the
// reload cannot loop).

import { toast } from 'haze-ui';

function offerReload(worker: ServiceWorker): void {
  let reloaded = false;
  const onControllerChange = () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange, { once: true });
  // duration 0 = persistent: the toast stays until the user decides (the
  // container renders a dismiss × next to the action).
  toast.info('Reload to pick up the update.', {
    title: 'A new version is available.',
    duration: 0,
    action: {
      label: 'Reload',
      onClick: () => worker.postMessage({ type: 'SKIP_WAITING' }),
    },
  });
}

export function registerPwa(): void {
  if (!import.meta.env.PROD) return;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  const swUrl = `${import.meta.env.BASE_URL}sw.js`;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        // A worker may already be mid-install when register() resolves —
        // check once immediately, then keep listening for future ones
        // (browsers re-check for updates on navigation and every ~24h).
        // The immediate check and the updatefound event can name the SAME
        // worker; watched guards against double-attaching its statechange
        // listener (which would surface the update toast twice).
        let watched: ServiceWorker | null = null;
        const watchInstalling = () => {
          const installing = registration.installing;
          if (!installing || installing === watched) return;
          watched = installing;
          installing.addEventListener('statechange', () => {
            // controller exists ⇒ an older worker controls this page, so
            // "installed" means an UPDATE is waiting, not a first install.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              offerReload(installing);
            }
          });
        };
        registration.addEventListener('updatefound', watchInstalling);
        watchInstalling();
      })
      .catch(() => {
        // Enhancement only — never surface.
      });
  });
}
