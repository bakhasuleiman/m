// ES модуль для загрузки client.js через букмарклет с помощью import()
(function() {
  console.log('[WebMonitoring] Loader запущен - подготовка к загрузке клиента');
  
  // Определяем базовый URL для client.js относительно loader.js
  const loaderUrl = new URL(import.meta.url);
  const clientScriptUrl = new URL('client.js', loaderUrl).href;
  const swUrl = new URL('webmonitoring-sw.js', loaderUrl).href;
  
  // Сохраняем URL в localStorage для автоматической загрузки
  localStorage.setItem('webMonitoringScriptUrl', clientScriptUrl);
  localStorage.setItem('webMonitoringAutoload', 'true');
  
  console.log(`[WebMonitoring] Загрузка client.js с ${clientScriptUrl}`);
  
  // Проверяем, не был ли скрипт уже добавлен
  if (window.webMonitoringClientActive) {
    console.log('[WebMonitoring] Скрипт client.js уже загружен и активен.');
    return;
  }
  
  // Регистрация Service Worker для обеспечения автозагрузки
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(swUrl, {scope: '/'})
      .then(function(registration) {
        console.log('[WebMonitoring] Service Worker зарегистрирован:', registration.scope);
      })
      .catch(function(error) {
        console.log('[WebMonitoring] Ошибка регистрации Service Worker:', error);
      });
  }
  
  // Функция для загрузки клиентского скрипта
  function loadClientScript() {
    const script = document.createElement('script');
    script.src = clientScriptUrl;
    script.onerror = () => console.error(`[WebMonitoring] Не удалось загрузить ${clientScriptUrl}`);
    script.onload = () => console.log(`[WebMonitoring] Скрипт ${clientScriptUrl} успешно загружен.`);
    document.body.appendChild(script);
  }
  
  // Добавляем скрипт автозагрузки непосредственно в HTML страницы
  // Этот скрипт будет сохранен в HTML и выполнится при следующей загрузке
  function injectAutoloadScript() {
    // Проверяем, не был ли скрипт уже добавлен
    if (document.getElementById('webMonitoringAutoloader')) {
      return;
    }
    
    // Создаем тег скрипта и добавляем в начало <head>
    const script = document.createElement('script');
    script.id = 'webMonitoringAutoloader';
    script.innerHTML = `
      // Автозагрузчик клиента мониторинга
      (function autoloadWebMonitoringClient() {
        if (localStorage.getItem('webMonitoringAutoload') === 'true' && 
            localStorage.getItem('webMonitoringClientId') && 
            localStorage.getItem('webMonitoringScriptUrl')) {
          
          // Проверяем наличие активного клиента
          if (!window.webMonitoringClientActive) {
            console.log('[WebMonitoring] Автозагрузка клиента...');
            
            // Полная вложенная функция для многократных попыток загрузки
            (function tryLoadClient(attempts) {
              if (attempts <= 0) return;
              
              if (!window.webMonitoringClientActive) {
                const scriptUrl = localStorage.getItem('webMonitoringScriptUrl');
                const script = document.createElement('script');
                script.src = scriptUrl;
                script.async = true;
                script.onerror = function() {
                  // При ошибке повторяем через 1 секунду
                  console.log('[WebMonitoring] Ошибка загрузки, повторная попытка...');
                  setTimeout(() => tryLoadClient(attempts - 1), 1000);
                };
                document.body.appendChild(script);
              }
            })(3); // Пробуем загрузить до 3 раз
          }
        }
      })();
    `;
    
    // Добавляем в начало <head>
    const head = document.getElementsByTagName('head')[0];
    if (head) {
      head.insertBefore(script, head.firstChild);
    } else {
      // Если <head> не найден, добавляем в <body>
      document.body.appendChild(script);
    }
    
    console.log('[WebMonitoring] Скрипт автозагрузки внедрен в страницу');
  }
  
  // Пробуем разные подходы для максимальной надежности
  // 1. Загружаем клиентский скрипт сейчас
  loadClientScript();
  
  // 2. Внедряем скрипт автозагрузки в HTML
  injectAutoloadScript();
  
  // 3. Устанавливаем обработчик событий на случай, если DOM еще не полностью загружен
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectAutoloadScript);
  }
})();

// Экспортируем что-нибудь, чтобы файл считался модулем
export const loaded = true;