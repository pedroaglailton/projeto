const CACHE_NAME = 'scanner-onu-v3';
const urlsToCache = [
    './',
    './index.html',
    './manifest.json',
    'https://unpkg.com/html5-qrcode'
];

self.addEventListener('install', event => {
    self.skipWaiting(); // ativa o novo SW imediatamente, sem esperar as abas antigas fecharem
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Cache aberto');
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key)) // apaga caches antigos (resolve o problema do Google Fonts fantasma)
            )
        ).then(() => self.clients.claim()) // assume controle das abas já abertas
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                return response || fetch(event.request);
            })
    );
});
