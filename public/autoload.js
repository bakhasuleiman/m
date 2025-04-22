/**
 * Автоматический загрузчик клиента мониторинга
 * Загружается на клиенте при первом запуске и затем
 * обеспечивает автоматическую загрузку клиента после перезагрузки страницы
 */
(function() {
  console.log('[WebMonitoring Autoloader] Запуск автозагрузчика...');
  
  // Проверяем, должен ли быть загружен клиент
  const shouldLoad = localStorage.getItem('webMonitoringAutoload') === 'true' && 
                    localStorage.getItem('webMonitoringClientId');
                    
  if (!shouldLoad) {
    console.log('[WebMonitoring Autoloader] Автозагрузка отключена или нет сохраненного ID клиента');
    return;
  }
  
  // Проверяем, не запущен ли уже клиент
  if (window.webMonitoringClientActive) {
    console.log('[WebMonitoring Autoloader] Клиент мониторинга уже активен');
    return;
  }
  
  // Получаем URL скрипта из localStorage
  let scriptUrl = localStorage.getItem('webMonitoringScriptUrl');
  if (!scriptUrl) {
    console.log('[WebMonitoring Autoloader] URL клиентского скрипта не найден в localStorage');
    return;
  }
  
  // Обновляем протокол, если необходимо (для избежания Mixed Content ошибок)
  if (window.location.protocol === 'https:' && scriptUrl.startsWith('http:')) {
    scriptUrl = scriptUrl.replace('http:', 'https:');
    // Сохраняем обновленный URL с https протоколом
    localStorage.setItem('webMonitoringScriptUrl', scriptUrl);
    console.log('[WebMonitoring Autoloader] URL обновлен для использования HTTPS');
  }
  
  console.log('[WebMonitoring Autoloader] Загрузка клиента из:', scriptUrl);
  
  // Функция загрузки клиентского скрипта с повторными попытками
  function loadClientScript(maxAttempts = 3, delay = 1000) {
    let attempt = 0;
    
    function tryLoad() {
      if (window.webMonitoringClientActive) {
        console.log('[WebMonitoring Autoloader] Клиент уже загружен и активен');
        return;
      }
      
      if (attempt >= maxAttempts) {
        console.error('[WebMonitoring Autoloader] Достигнуто максимальное количество попыток загрузки');
        return;
      }
      
      attempt++;
      console.log(`[WebMonitoring Autoloader] Попытка загрузки ${attempt}/${maxAttempts}`);
      
      const script = document.createElement('script');
      script.src = scriptUrl;
      script.async = true;
      
      script.onload = function() {
        console.log('[WebMonitoring Autoloader] Скрипт клиента успешно загружен');
      };
      
      script.onerror = function(error) {
        console.error('[WebMonitoring Autoloader] Ошибка загрузки скрипта:', error);
        // Повторная попытка через указанный промежуток времени
        setTimeout(tryLoad, delay);
      };
      
      document.body.appendChild(script);
    }
    
    // Начинаем загрузку
    tryLoad();
  }
  
  // Ждем, когда DOM будет полностью загружен
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      loadClientScript();
    });
  } else {
    // DOM уже загружен
    loadClientScript();
  }
})(); 