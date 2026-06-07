// CAMCONTROL PREVENTIVA-CE — Service Worker
// Estratégias:
//   - HTML (index.html, /)            -> network-first com fallback ao cache (sempre tenta versão nova)
//   - CDNs (leaflet, jspdf, fontes)   -> cache-first com revalidação (stale-while-revalidate)
//   - Tiles de mapa                   -> cache-first, NUNCA cair em index.html (evita Leaflet quebrar)
//   - API (/api/*)                    -> network-only, nunca cacheia
//
// Bump CACHE_VERSION a cada release para invalidar caches antigos.

const CACHE_VERSION = 'v2026.06.07-03';
const CACHE_CORE    = `preventiva-core-${CACHE_VERSION}`;
const CACHE_CDN     = `preventiva-cdn-${CACHE_VERSION}`;
const CACHE_TILES   = `preventiva-tiles-${CACHE_VERSION}`;

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './app-icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon-180.png'
];

// Pré-cache de CDNs críticas (para funcionar offline em campo no iOS)
const CDN_ASSETS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap',
  'https://fonts.googleapis.com/icon?family=Material+Icons'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const core = await caches.open(CACHE_CORE);
    await core.addAll(CORE_ASSETS).catch(err => console.warn('[SW] core cache parcial:', err));

    const cdn = await caches.open(CACHE_CDN);
    // CDNs podem falhar em rede ruim — não bloqueia o install se uma cair
    await Promise.all(CDN_ASSETS.map(url =>
      fetch(url, { mode: 'no-cors' })
        .then(resp => cdn.put(url, resp))
        .catch(err => console.warn('[SW] CDN miss:', url, err))
    ));

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const valid = new Set([CACHE_CORE, CACHE_CDN, CACHE_TILES]);
    await Promise.all(keys.filter(k => !valid.has(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isHtmlRequest(req) {
  return req.mode === 'navigate' ||
         (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'));
}

function isApiRequest(url) {
  // Same-origin: path /api/*
  if (url.pathname.startsWith('/api/')) return true;
  // Cross-origin: heuristica — qualquer host cujo path comece com /api/
  // E que NAO seja CDN conhecida. Como nao temos a URL base aqui (SW não
  // tem acesso ao localStorage), confiamos no padrao /api/ em outros hosts.
  // Para tuneis Cloudflare/ngrok que servem direto a API, isso cobre.
  return false;
}

function isTileRequest(url) {
  return /tile\.openstreetmap\.org|basemaps\.cartocdn\.com|tile\.cartocdn\.com/.test(url.hostname);
}

function isCdnRequest(url) {
  return /unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url.hostname);
}

// cache-first para HTML — mostra instantâneo, atualiza em 2o plano
async function staleHtmlWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req) || await cache.match('./index.html');
  const networkPromise = fetch(req).then(resp => {
    if (resp && resp.ok) cache.put(req, resp.clone()).catch(() => {});
    return resp;
  }).catch(() => null);
  if (cached) return cached;
  return networkPromise || new Response('Offline', { status: 503, statusText: 'Offline' });
}

// cache-first com revalidação em background — ótimo p/ CDN e tiles
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then(resp => {
    if (resp && (resp.ok || resp.type === 'opaque')) {
      cache.put(req, resp.clone()).catch(() => {});
    }
    return resp;
  }).catch(() => null);
  return cached || networkPromise || new Response('', { status: 504 });
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // API (qualquer host cujo path comece com /api/) — nunca cacheada
  if (url.pathname.startsWith('/api/')) return;

  // Cross-origin que NAO seja CDN/tiles conhecida — nao intercepta
  // (deixa o navegador resolver direto; cobre tunel da API hospedado
  // num dominio diferente da PWA)
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !isTileRequest(url) && !isCdnRequest(url)) {
    return;
  }

  // HTML / navegação -> cache-first (abre na hora, atualiza em 2o plano)
  if (isHtmlRequest(req)) {
    event.respondWith(staleHtmlWhileRevalidate(req, CACHE_CORE));
    return;
  }

  // Tiles de mapa -> stale-while-revalidate em cache separado
  if (isTileRequest(url)) {
    event.respondWith(staleWhileRevalidate(req, CACHE_TILES));
    return;
  }

  // CDNs -> stale-while-revalidate
  if (isCdnRequest(url)) {
    event.respondWith(staleWhileRevalidate(req, CACHE_CDN));
    return;
  }

  // Mesma origem (ícones, sw.js, manifest etc.) -> cache-first com fallback à rede
  if (sameOrigin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_CORE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        if (resp && resp.ok) cache.put(req, resp.clone()).catch(() => {});
        return resp;
      } catch (_) {
        return new Response('Offline', { status: 503 });
      }
    })());
    return;
  }
});

// Mensagem do app para forçar atualização
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'FLUSH_QUEUES') {
    event.waitUntil((async () => {
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.postMessage({ type: 'SYNC_QUEUES' });
      }
    })());
  }
});

// ============================================================================
// Push Notifications
// ============================================================================
self.addEventListener('push', event => {
  let payload = { title: 'Preventiva-CE', body: '', data: {} };
  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    }
  } catch (_) {
    payload.body = event.data ? event.data.text() : '';
  }

  const options = {
    body: payload.body,
    icon: './app-icon.svg',
    badge: './app-icon.svg',
    vibrate: Array.isArray(payload.vibrate) && payload.vibrate.length
      ? payload.vibrate
      : [100, 50, 100],
    tag: payload.tag || 'preventiva-notification',
    renotify: payload.renotify !== false,
    requireInteraction: false,
    data: payload.data || {},
    actions: [
      { action: 'ok', title: '✅ OK' },
      { action: 'feito', title: '👍 Feito' },
      { action: 'abrir', title: '💬 Responder' }
    ]
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const action = event.action;
  const data = event.notification.data || {};
  const token = data.teamToken;
  const body = event.notification.body || '';

  if ((action === 'ok' || action === 'feito') && token) {
    event.waitUntil((async () => {
      const resposta = action === 'ok' ? 'OK' : 'Feito!';
      try {
        await fetch('./api/mensagens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Equipe-Token': token },
          body: JSON.stringify({ texto: resposta, tipo: 'predefinida' })
        });
      } catch (_) {}
      // Mostra toast no app se aberto
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: 'REPLY_SENT', texto: resposta });
      }
    })());
    return;
  }

  const url = data.url || './index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        for (const client of windowClients) {
          if (client.url.includes(location.origin) && 'focus' in client) {
            client.postMessage({ type: 'OPEN_MESSAGES' });
            return client.focus();
          }
        }
        return clients.openWindow(url);
      })
  );
});

// ============================================================================
// Background Sync
// ============================================================================
self.addEventListener('sync', event => {
  if (event.tag === 'sync-preventiva') {
    event.waitUntil((async () => {
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.postMessage({ type: 'SYNC_QUEUES' });
      }
    })());
  }
});

// Cache flush quando voltar online
self.addEventListener('online', () => {
  self.clients.matchAll({ type: 'window' }).then(clients => {
    for (const client of clients) {
      client.postMessage({ type: 'ONLINE' });
    }
  });
});
