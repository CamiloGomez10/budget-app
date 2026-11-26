// Service worker: gör appen tillgänglig offline.
// Versionen finns i js/version.js – höj den där när filerna ändras så att den gamla cachen rensas.
importScripts('./js/version.js');
const CACHE = 'budget-v' + self.APP_VERSION;
const FONT_CACHE = 'budget-fonts-v1';

const SHELL = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './icon.svg',
  './css/pages-a.css',
  './css/pages-b.css',
  './css/pages-c.css',
  './js/version.js',
  './js/select.js',
  './js/monthpicker.js',
  './js/datepicker.js',
  './js/stepper.js',
  './js/vendor/supabase.js',
  './js/core.js',
  './js/sync.js',
  './js/assistant.js',
  './js/pages/dashboard.js',
  './js/pages/annual.js',
  './js/pages/monthly.js',
  './js/pages/transactions.js',
  './js/pages/bills.js',
  './js/pages/accounts.js',
  './js/pages/savings.js',
  './js/pages/debts.js',
  './js/pages/reports.js',
  './js/pages/setup.js',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== FONT_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: nätverket först, cachen som reserv
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(FONT_CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Appens egna filer: cachen först
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html')))
    );
  }
});
