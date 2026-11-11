'use strict';
// Makes the page installable as an app. Network only on purpose: the launcher needs its live backend, nothing is cached.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* pass through to the network */ });
