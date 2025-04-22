// ES модуль для загрузки client.js через букмарклет с помощью import()
(function() {
  console.log('[WebMonitoring] Loader запущен - подготовка к загрузке клиента');
  
  // Определяем базовый URL для client.js относительно loader.js
  const loaderUrl = new URL(import.meta.url);
  const clientScriptUrl = new URL('client.js', loaderUrl).href;
  
  // Сохраняем URL в localStorage для автоматической загрузки
  localStorage.setItem('webMonitoringScriptUrl', clientScriptUrl);
  localStorage.setItem('webMonitoringAutoload', 'true');
  
  console.log(`[WebMonitoring] Загрузка client.js с ${clientScriptUrl}`);
  
  // Проверяем, не был ли скрипт уже добавлен
  if (window.webMonitoringClientActive) {
    console.log('[WebMonitoring] Скрипт client.js уже загружен и активен.');
    return;
  }
  
  // Функция для загрузки скрипта
  function loadClientScript() {
    const script = document.createElement('script');
    script.src = clientScriptUrl;
    script.onerror = () => console.error(`[WebMonitoring] Не удалось загрузить ${clientScriptUrl}`);
    script.onload = () => console.log(`[WebMonitoring] Скрипт ${clientScriptUrl} успешно загружен.`);
    document.body.appendChild(script);
  }
  
  // Загружаем клиентский скрипт
  loadClientScript();
})();

// Экспортируем что-нибудь, чтобы файл считался модулем
export const loaded = true;