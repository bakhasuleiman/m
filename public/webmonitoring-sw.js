// Service Worker для автозагрузки клиента мониторинга при обновлении страницы
self.addEventListener('install', function(event) {
  console.log('[WebMonitoring SW] Service Worker установлен');
  self.skipWaiting(); // Активируемся немедленно
});

self.addEventListener('activate', function(event) {
  console.log('[WebMonitoring SW] Service Worker активирован');
  return self.clients.claim(); // Берем контроль над клиентами
});

// При навигации (в том числе обновлении страницы) проверяем необходимость загрузки клиента
self.addEventListener('fetch', function(event) {
  // Не перехватываем запросы - позволяем им проходить как обычно
  // Но в будущем здесь можно добавить логику для предварительной загрузки клиента
});

// Обработка сообщений от клиента
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'REGISTER_CLIENT') {
    console.log('[WebMonitoring SW] Регистрация клиента:', event.data.clientId);
    
    // В будущем здесь можно добавить код для сохранения данных клиента
    // и помочь с автоматической перезагрузкой
    
    // Отправляем подтверждение
    event.source.postMessage({
      type: 'SW_REGISTERED',
      timestamp: new Date().toISOString()
    });
  }
});

// Функция для отправки сообщения всем клиентам
function notifyAllClients(message) {
  self.clients.matchAll().then(function(clients) {
    clients.forEach(function(client) {
      client.postMessage(message);
    });
  });
} 