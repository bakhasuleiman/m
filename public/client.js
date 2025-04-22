/**
 * Клиентский скрипт для сбора данных со страницы
 * Внедряется через букмарклет: 
 * javascript:(function(){var s=document.createElement('script');s.src='http://localhost:3000/client.js';document.body.appendChild(s);})()
 */

// Убираем предыдущий код автозагрузки, теперь он находится в loader.js
// Основной код клиента мониторинга
(function() {
  // Проверяем, не запущен ли скрипт уже
  if (window.webMonitoringClientActive) {
    console.warn('Клиент мониторинга уже запущен на этой странице');
    return;
  }
  
  // Отмечаем, что скрипт запущен
  window.webMonitoringClientActive = true;
  
  // Ключи для localStorage
  const STORAGE_KEY_CLIENT_ID = 'webMonitoringClientId';
  const STORAGE_KEY_IS_PAUSED = 'webMonitoringIsPaused';
  const STORAGE_KEY_SETTINGS = 'webMonitoringSettings';
  const STORAGE_KEY_SCRIPT_URL = 'webMonitoringScriptUrl';
  const STORAGE_KEY_MESSAGE_HISTORY = 'webMonitoringMessageHistory';
  const STORAGE_KEY_AUTOLOAD = 'webMonitoringAutoload';
  
  // Сохраняем URL скрипта для автоматической загрузки при обновлении страницы
  if (document.currentScript && document.currentScript.src) {
    localStorage.setItem(STORAGE_KEY_SCRIPT_URL, document.currentScript.src);
    console.log('[WebMonitoring] URL клиентского скрипта сохранен:', document.currentScript.src);
    
    // Автоматически внедряем автозагрузчик для будущих перезагрузок
    injectAutoloader(document.currentScript.src);
  }

  // Устанавливаем флаг автозагрузки
  localStorage.setItem(STORAGE_KEY_AUTOLOAD, 'true');
  
  // Настройки
  let settings = {
    updateInterval: 25 * 60 * 1000, // 25 минут в миллисекундах
    textOpacity: 0.7
  };
  
  // ID клиента и статусы
  let clientId = localStorage.getItem(STORAGE_KEY_CLIENT_ID) || null;
  let isPaused = localStorage.getItem(STORAGE_KEY_IS_PAUSED) === 'true';
  let updateTimer = null;
  let reconnectAttempts = 0;
  let ws = null;
  
  // Восстанавливаем настройки из localStorage, если есть
  const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
  if (savedSettings) {
    try {
      settings = JSON.parse(savedSettings);
    } catch (e) {
      console.error('Ошибка при восстановлении настроек:', e);
    }
  }
  
  // Регистрация в Service Worker, если он активен
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    // Отправляем сообщение активному Service Worker
    navigator.serviceWorker.controller.postMessage({
      type: 'REGISTER_CLIENT',
      clientId: clientId,
      timestamp: new Date().toISOString()
    });
    
    // Обработка сообщений от Service Worker
    navigator.serviceWorker.addEventListener('message', function(event) {
      if (event.data && event.data.type === 'SW_REGISTERED') {
        console.log('[WebMonitoring] Клиент зарегистрирован в Service Worker:', event.data.timestamp);
      }
    });
  }
  
  // История сообщений
  let messageHistory = [];
  
  // Восстанавливаем историю сообщений из localStorage
  const savedMessageHistory = localStorage.getItem(STORAGE_KEY_MESSAGE_HISTORY);
  if (savedMessageHistory) {
    try {
      messageHistory = JSON.parse(savedMessageHistory);
      console.log(`[WebMonitoring] Восстановлено ${messageHistory.length} сообщений из localStorage`);
    } catch (e) {
      console.error('Ошибка при восстановлении истории сообщений:', e);
    }
  }
  
  let isMessageHistoryVisible = false;
  let currentMessageIndex = -1;
  let messageHistoryContainer = null;
  let messageViewerPosition = { x: 10, y: 10 };
  let messageViewerFontSize = 12;
  let messageViewerOpacity = 0.8;
  let showInstructions = true; // Флаг для отображения/скрытия инструкций
  
  // Подключение к серверу
  function connectToServer() {
    // Определяем хост сервера динамически на основе текущего скрипта
    const scriptSrc = document.currentScript 
      ? document.currentScript.src 
      : localStorage.getItem(STORAGE_KEY_SCRIPT_URL) || 'http://localhost:3000/client.js';
    
    // Преобразуем URL скрипта в WebSocket URL
    let serverUrl;
    try {
      // Используем явно протокол страницы для соответствия безопасности
      const currentProtocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
      const url = new URL(scriptSrc);
      
      // Если текущая страница загружена по HTTPS, используем WSS, иначе WS
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      
      // Если текущая страница HTTPS, а скрипт HTTP, обновим URL скрипта в localStorage
      if (currentProtocol === 'https:' && url.protocol === 'http:') {
        const newScriptSrc = scriptSrc.replace('http:', 'https:');
        localStorage.setItem(STORAGE_KEY_SCRIPT_URL, newScriptSrc);
        console.log('[WebMonitoring] URL скрипта обновлен с HTTP на HTTPS:', newScriptSrc);
      }
      
      serverUrl = `${wsProtocol}//${url.host}`;
    } catch (e) {
      // Если не удалось преобразовать URL, используем значение по умолчанию
      console.error('[WebMonitoring] Ошибка определения URL сервера:', e);
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      serverUrl = scriptSrc.replace('/client.js', '').replace(/(http|https):/, wsProtocol);
    }
    
    console.log('[WebMonitoring] Подключение к серверу:', serverUrl);
    
    // Проверяем, открыто ли уже соединение с таким же URL
    if (ws && ws.readyState === WebSocket.OPEN && ws._serverUrl === serverUrl) {
      console.log('[WebMonitoring] Соединение уже установлено');
      return;
    }
    
    // Закрываем предыдущее соединение, если есть
    if (ws) {
      try {
        ws.close();
      } catch (e) {
        // Игнорируем ошибки закрытия
      }
    }
    
    ws = new WebSocket(serverUrl);
    ws._serverUrl = serverUrl; // Запоминаем URL для проверки
    
    // Устанавливаем тайм-аут на соединение
    const connectionTimeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.log('[WebMonitoring] Тайм-аут соединения, повторная попытка...');
        ws.close();
        
        // Повторная попытка через увеличивающийся интервал
        const retryDelay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts));
        reconnectAttempts++;
        setTimeout(connectToServer, retryDelay);
      }
    }, 10000); // 10 секунд тайм-аут
    
    ws.onopen = function() {
      console.log('[WebMonitoring] Подключение к серверу установлено');
      clearTimeout(connectionTimeout);
      reconnectAttempts = 0;
      
      // Регистрируемся на сервере (отправляем clientId, если он сохранен)
      ws.send(JSON.stringify({
        type: 'register',
        role: 'client',
        clientId: clientId
      }));
    };
    
    ws.onmessage = function(event) {
      try {
        const message = JSON.parse(event.data);
        
        switch (message.type) {
          case 'registered':
            clientId = message.clientId;
            // Сохраняем clientId в localStorage
            localStorage.setItem(STORAGE_KEY_CLIENT_ID, clientId);
            
            // Применяем полученные от сервера настройки
            if (message.settings) {
              settings = message.settings;
              // Сохраняем настройки в localStorage
              localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
            }
            
            console.log(`Зарегистрирован как клиент: ${clientId}`);
            
            // Запускаем сбор данных
            startDataCollection();
            break;
            
          case 'pause':
            isPaused = true;
            // Сохраняем состояние в localStorage
            localStorage.setItem(STORAGE_KEY_IS_PAUSED, 'true');
            stopDataCollection();
            console.log('Сбор данных приостановлен');
            break;
            
          case 'resume':
            isPaused = false;
            // Сохраняем состояние в localStorage
            localStorage.setItem(STORAGE_KEY_IS_PAUSED, 'false');
            startDataCollection();
            console.log('Сбор данных возобновлен');
            break;
            
          case 'remove':
            stopDataCollection();
            disconnectFromServer();
            window.webMonitoringClientActive = false;
            // Удаляем все данные из localStorage
            localStorage.removeItem(STORAGE_KEY_CLIENT_ID);
            localStorage.removeItem(STORAGE_KEY_IS_PAUSED);
            localStorage.removeItem(STORAGE_KEY_SETTINGS);
            localStorage.removeItem(STORAGE_KEY_MESSAGE_HISTORY);
            localStorage.removeItem(STORAGE_KEY_SCRIPT_URL);
            // Очищаем историю сообщений
            messageHistory = [];
            // Скрываем просмотрщик сообщений, если он открыт
            if (isMessageHistoryVisible) {
              hideMessageHistory();
            }
            console.log('Клиент удален');
            break;
            
          case 'message':
            displayMessage(message.text, message.opacity, message.id);
            break;
            
          case 'clearMessages':
            // Очищаем историю сообщений
            messageHistory = [];
            // Удаляем сохраненную историю из localStorage
            localStorage.removeItem(STORAGE_KEY_MESSAGE_HISTORY);
            console.log('[WebMonitoring] История сообщений очищена по команде с сервера');
            
            // Скрываем просмотрщик, если он открыт
            if (isMessageHistoryVisible) {
              hideMessageHistory();
            }
            break;
            
          case 'settingsUpdate':
            if (message.settings) {
              settings = message.settings;
              // Сохраняем настройки в localStorage
              localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
              console.log('Настройки обновлены', settings);
              
              // Перезапускаем сбор данных с новыми настройками
              if (!isPaused) {
                stopDataCollection();
                startDataCollection();
              }
            }
            break;
            
          case 'messageHistory':
            if (message.messages && Array.isArray(message.messages)) {
              console.log(`Получена история сообщений (${message.messages.length}) с сервера`);
              
              // Обрабатываем полученные сообщения
              const serverMessages = message.messages.map(msg => ({
                id: msg.id, // Сохраняем ID сообщения
                text: msg.text,
                opacity: msg.opacity || settings.textOpacity,
                timestamp: new Date(msg.timestamp)
              }));
              
              // Просто заменяем историю сообщений серверной версией
              // Эта история уже содержит все актуальные версии сообщений
              messageHistory = serverMessages;
              
              // Сохраняем в localStorage
              saveMessageHistory();
              
              console.log(`История сообщений заменена серверной (${serverMessages.length} сообщений)`);
              
              // Если просмотрщик открыт, обновляем его
              if (isMessageHistoryVisible && messageHistory.length > 0) {
                currentMessageIndex = messageHistory.length - 1;
                displayMessageFromHistory(currentMessageIndex);
              }
            }
            break;
        }
      } catch (error) {
        console.error('Ошибка обработки сообщения:', error);
      }
    };
    
    ws.onclose = function() {
      console.log('[WebMonitoring] Соединение с сервером закрыто');
      
      // Очищаем тайм-аут, если он был установлен
      if (this._connectionTimeout) {
        clearTimeout(this._connectionTimeout);
      }
      
      // Останавливаем сбор данных
      stopDataCollection();
      
      // Пытаемся переподключиться с увеличивающейся задержкой
      if (window.webMonitoringClientActive) {
        const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts));
        reconnectAttempts++;
        
        console.log(`[WebMonitoring] Попытка переподключения через ${delay}мс...`);
        
        // Сохраняем таймер переподключения для возможной отмены
        this._reconnectTimer = setTimeout(() => {
          console.log('[WebMonitoring] Выполняем переподключение...');
          connectToServer();
        }, delay);
      }
    };
    
    ws.onerror = function(error) {
      console.error('Ошибка WebSocket:', error);
    };
  }
  
  // Отключение от сервера
  function disconnectFromServer() {
    if (ws) {
      ws.close();
      ws = null;
    }
  }
  
  // Сбор данных со страницы
  function collectPageData() {
    try {
      // Эмулируем jQuery, если он не доступен
      if (!window.jQuery) {
        emulateJQuery();
      }
      
      const data = {
        type: 'update',
        url: window.location.href,
        title: document.title,
        text: extractPageText(),
        html: document.documentElement.outerHTML
      };
      
      // Отправляем данные на сервер
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
        console.log('Данные страницы отправлены на сервер');
      }
    } catch (error) {
      console.error('Ошибка сбора данных:', error);
    }
  }
  
  // Извлечение текста страницы
  function extractPageText() {
    // Получаем текст из body, игнорируя скрипты и стили
    const bodyText = document.body.innerText || '';
    
    // Удаляем лишние пробелы и переносы строк
    return bodyText.replace(/\\s+/g, ' ').trim();
  }
  
  // Запуск сбора данных
  function startDataCollection() {
    if (isPaused) return;
    
    // Собираем данные сразу при запуске
    collectPageData();
    
    // Настраиваем периодический сбор данных
    updateTimer = setInterval(collectPageData, settings.updateInterval);
    console.log(`Настроен сбор данных каждые ${settings.updateInterval / 60000} минут`);
  }
  
  // Остановка сбора данных
  function stopDataCollection() {
    if (updateTimer) {
      clearInterval(updateTimer);
      updateTimer = null;
    }
  }
  
  // Отображение сообщения от админа
  function displayMessage(text, opacity, messageId) {
    // Удаляем предыдущее сообщение, если есть
    const existingMsg = document.getElementById('admin-message');
    if (existingMsg) {
      existingMsg.remove();
    }
    
    // Сохраняем сообщение в историю
    messageHistory.push({
      id: messageId || 'local_' + Date.now(), // Используем ID от сервера или генерируем временный
      text: text,
      opacity: opacity || settings.textOpacity,
      timestamp: new Date()
    });
    
    // Сохраняем обновленную историю в localStorage
    saveMessageHistory();
    
    // Создаем контейнер для сообщения
    const msgElement = document.createElement('div');
    msgElement.id = 'admin-message';
    msgElement.innerText = text;
    
    // Стилизуем элемент
    Object.assign(msgElement.style, {
      position: 'fixed',
      left: '10px',
      bottom: '10px',
      fontSize: '8px',
      color: '#999',
      opacity: opacity || settings.textOpacity,
      zIndex: '999999',
      pointerEvents: 'none',
      fontFamily: 'Arial, sans-serif',
      maxWidth: '200px',
      padding: '5px',
      backgroundColor: 'transparent',
      borderRadius: '3px'
    });
    
    // Добавляем в DOM
    document.body.appendChild(msgElement);
    
    // Автоматически удаляем через 0.7 секунд
    setTimeout(() => {
      if (msgElement.parentNode) {
        msgElement.remove();
      }
    }, 700);
  }
  
  // Функция для сохранения истории сообщений в localStorage
  function saveMessageHistory() {
    // Ограничиваем историю последними 100 сообщениями чтобы избежать переполнения localStorage
    const historyToSave = messageHistory.slice(-100);
    localStorage.setItem(STORAGE_KEY_MESSAGE_HISTORY, JSON.stringify(historyToSave));
    console.log(`[WebMonitoring] Сохранено ${historyToSave.length} сообщений в localStorage`);
  }
  
  // Создание интерфейса для просмотра истории сообщений
  function createMessageHistoryInterface() {
    // Если контейнер уже существует, просто показываем его
    if (messageHistoryContainer) {
      // Обновляем видимость инструкций
      const instructionsElement = messageHistoryContainer.querySelector('.instructions-container');
      if (instructionsElement) {
        instructionsElement.style.display = showInstructions ? 'block' : 'none';
      }
      
      messageHistoryContainer.style.display = 'block';
      // Применяем текущие настройки
      updateMessageViewerPosition();
      updateMessageViewerFontSize();
      updateMessageViewerOpacity();
      return;
    }
    
    // Создаем контейнер для истории сообщений
    messageHistoryContainer = document.createElement('div');
    messageHistoryContainer.id = 'message-history-container';
    
    // Стилизуем контейнер (прозрачный без теней, компактный)
    Object.assign(messageHistoryContainer.style, {
      position: 'fixed',
      left: messageViewerPosition.x + 'px',
      bottom: messageViewerPosition.y + 'px',
      width: 'auto',
      maxWidth: '250px',
      backgroundColor: 'transparent',
      boxShadow: 'none',
      padding: '5px',
      zIndex: '1000000',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'Arial, sans-serif'
    });
    
    // Создаем контейнер для сообщений
    const messagesContainer = document.createElement('div');
    messagesContainer.id = 'messages-list';
    Object.assign(messagesContainer.style, {
      overflow: 'hidden',
      fontSize: messageViewerFontSize + 'px',
      color: '#aaa', // Светло-серый цвет
      opacity: messageViewerOpacity
    });
    
    // Создаем панель с инструкциями (более компактная)
    const instructions = document.createElement('div');
    instructions.className = 'instructions-container';
    instructions.style.display = showInstructions ? 'block' : 'none';
    Object.assign(instructions.style, {
      marginTop: '2px',
      textAlign: 'left'
    });
    
    const instructionsText = document.createElement('div');
    instructionsText.innerText = 'Alt+Q: вкл/выкл | ←→: листать | []: размер | Shift+9/0: прозрачность | Alt+↑↓←→: перемещение';
    Object.assign(instructionsText.style, {
      fontSize: (messageViewerFontSize - 2) + 'px',
      color: '#aaa',
      marginTop: '5px',
      opacity: messageViewerOpacity
    });
    
    instructions.appendChild(instructionsText);
    
    // Добавляем элементы в контейнер
    messageHistoryContainer.appendChild(messagesContainer);
    messageHistoryContainer.appendChild(instructions);
    
    // Добавляем контейнер в DOM
    document.body.appendChild(messageHistoryContainer);
  }
  
  // Обновление позиции просмотрщика сообщений
  function updateMessageViewerPosition() {
    if (messageHistoryContainer) {
      messageHistoryContainer.style.left = messageViewerPosition.x + 'px';
      messageHistoryContainer.style.bottom = messageViewerPosition.y + 'px';
    }
  }
  
  // Обновление размера шрифта просмотрщика сообщений
  function updateMessageViewerFontSize() {
    if (!messageHistoryContainer) return;
    
    console.log('Обновление размера шрифта до:', messageViewerFontSize + 'px');
    
    // Обновляем размер шрифта в контейнере сообщений
    const messagesContainer = document.getElementById('messages-list');
    if (messagesContainer) {
      messagesContainer.style.fontSize = messageViewerFontSize + 'px';
    }
    
    // Обновляем размер шрифта в инструкциях (более надежный способ)
    const instructions = messageHistoryContainer.querySelector('div div');
    if (instructions) {
      instructions.style.fontSize = (messageViewerFontSize - 2) + 'px';
    }
    
    // Перерисовываем текущее сообщение для обновления стилей
    if (currentMessageIndex >= 0) {
      displayMessageFromHistory(currentMessageIndex);
    }
  }
  
  // Обновление прозрачности просмотрщика сообщений
  function updateMessageViewerOpacity() {
    if (!messageHistoryContainer) return;
    
    console.log('Обновление прозрачности до:', messageViewerOpacity);
    
    // Обновляем прозрачность в контейнере сообщений
    const messagesContainer = document.getElementById('messages-list');
    if (messagesContainer) {
      messagesContainer.style.opacity = messageViewerOpacity;
    }
    
    // Обновляем прозрачность в инструкциях (более надежный способ)
    const instructions = messageHistoryContainer.querySelector('div div');
    if (instructions) {
      instructions.style.opacity = messageViewerOpacity;
    }
  }
  
  // Отображение сообщения из истории
  function displayMessageFromHistory(index) {
    if (index < 0 || index >= messageHistory.length) return;
    
    currentMessageIndex = index;
    const messagesContainer = document.getElementById('messages-list');
    if (!messagesContainer) return;
    
    // Очищаем контейнер
    messagesContainer.innerHTML = '';
    
    // Получаем сообщение
    const message = messageHistory[index];
    
    // Создаем компактный элемент для отображения сообщения
    const messageElement = document.createElement('div');
    
    // Компактное отображение в формате: (3/10) [12:30] Текст сообщения
    messageElement.innerHTML = `<span style="opacity: 0.6">(${index + 1}/${messageHistory.length})</span> <span style="opacity: 0.7">[${formatTimeShort(message.timestamp)}]</span> ${message.text}`;
    
    // Добавляем элементы в контейнер
    messagesContainer.appendChild(messageElement);
  }
  
  // Компактное форматирование времени (только часы:минуты)
  function formatTimeShort(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  
  // Форматирование времени (полное)
  function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  }
  
  // Показать историю сообщений
  function showMessageHistory(withInstructions = true) {
    isMessageHistoryVisible = true;
    showInstructions = withInstructions;
    createMessageHistoryInterface();
    
    // Показываем последнее сообщение если есть
    if (messageHistory.length > 0) {
      currentMessageIndex = messageHistory.length - 1;
      displayMessageFromHistory(currentMessageIndex);
    } else {
      const messagesContainer = document.getElementById('messages-list');
      if (messagesContainer) {
        messagesContainer.innerHTML = '<div style="text-align: center;">Нет сообщений</div>';
      }
    }
  }
  
  // Скрыть историю сообщений
  function hideMessageHistory() {
    isMessageHistoryVisible = false;
    if (messageHistoryContainer) {
      messageHistoryContainer.style.display = 'none';
    }
  }
  
  // Обработчик нажатия клавиш
  function handleKeyDown(event) {
    console.log('Нажата клавиша:', event.code, event.key, 'Alt:', event.altKey, 'Shift:', event.shiftKey);
    
    // Alt+Q для показа/скрытия истории сообщений с инструкциями
    if (event.altKey && (event.code === 'KeyQ' || event.key === 'q' || event.key === 'Q' || event.key === 'й' || event.key === 'Й')) {
      event.preventDefault();
      if (isMessageHistoryVisible) {
        hideMessageHistory();
      } else {
        showMessageHistory(true); // показать с инструкциями
      }
      return;
    }
    
    // Alt+W для показа/скрытия истории сообщений без инструкций
    if (event.altKey && (event.code === 'KeyW' || event.key === 'w' || event.key === 'W' || event.key === 'ц' || event.key === 'Ц')) {
      event.preventDefault();
      if (isMessageHistoryVisible) {
        hideMessageHistory();
      } else {
        showMessageHistory(false); // показать без инструкций
      }
      return;
    }
    
    // Если история сообщений видима, обрабатываем дополнительные команды
    if (isMessageHistoryVisible) {
      // Листание сообщений стрелками
      if (!event.altKey && (event.code === 'ArrowLeft' || event.key === 'ArrowLeft')) {
        event.preventDefault();
        if (currentMessageIndex > 0) {
          displayMessageFromHistory(currentMessageIndex - 1);
        }
      } else if (!event.altKey && (event.code === 'ArrowRight' || event.key === 'ArrowRight')) {
        event.preventDefault();
        if (currentMessageIndex < messageHistory.length - 1) {
          displayMessageFromHistory(currentMessageIndex + 1);
        }
      } 
      // Изменение размера шрифта через [ и ]
      else if (event.code === 'BracketLeft' || event.key === '[') {
        event.preventDefault();
        console.log('Уменьшение размера шрифта');
        if (messageViewerFontSize > 8) {
          messageViewerFontSize -= 1;
          updateMessageViewerFontSize();
        }
      } else if (event.code === 'BracketRight' || event.key === ']') {
        event.preventDefault();
        console.log('Увеличение размера шрифта');
        if (messageViewerFontSize < 24) {
          messageViewerFontSize += 1;
          updateMessageViewerFontSize();
        }
      } 
      // Изменение прозрачности через Shift+9 и Shift+0
      else if (event.shiftKey && (event.code === 'Digit9' || event.key === '(')) {
        event.preventDefault();
        console.log('Уменьшение прозрачности');
        if (messageViewerOpacity > 0.1) {
          messageViewerOpacity = Math.round((messageViewerOpacity - 0.1) * 10) / 10; // Округляем для точности
          updateMessageViewerOpacity();
        }
      } else if (event.shiftKey && (event.code === 'Digit0' || event.key === ')')) {
        event.preventDefault();
        console.log('Увеличение прозрачности');
        if (messageViewerOpacity < 1.0) {
          messageViewerOpacity = Math.round((messageViewerOpacity + 0.1) * 10) / 10; // Округляем для точности
          updateMessageViewerOpacity();
        }
      } 
      // Перемещение просмотрщика с помощью Alt+стрелки
      else if (event.altKey && (event.code === 'ArrowUp' || event.key === 'ArrowUp')) {
        event.preventDefault();
        messageViewerPosition.y += 10;
        updateMessageViewerPosition();
      } else if (event.altKey && (event.code === 'ArrowDown' || event.key === 'ArrowDown')) {
        event.preventDefault();
        messageViewerPosition.y -= 10;
        updateMessageViewerPosition();
      } else if (event.altKey && (event.code === 'ArrowLeft' || event.key === 'ArrowLeft')) {
        event.preventDefault();
        messageViewerPosition.x -= 10;
        updateMessageViewerPosition();
      } else if (event.altKey && (event.code === 'ArrowRight' || event.key === 'ArrowRight')) {
        event.preventDefault();
        messageViewerPosition.x += 10;
        updateMessageViewerPosition();
      } else if (event.code === 'Escape' || event.key === 'Escape') {
        event.preventDefault();
        hideMessageHistory();
      }
    }
  }
  
  // Эмуляция базового функционала jQuery
  function emulateJQuery() {
    window.jQuery = function(selector) {
      const elements = document.querySelectorAll(selector);
      
      return {
        text: function() {
          if (elements.length > 0) {
            return elements[0].innerText;
          }
          return '';
        },
        html: function() {
          if (elements.length > 0) {
            return elements[0].innerHTML;
          }
          return '';
        },
        find: function(childSelector) {
          if (elements.length > 0) {
            const found = elements[0].querySelectorAll(childSelector);
            return window.jQuery(found);
          }
          return window.jQuery([]);
        }
      };
    };
    
    window.$ = window.jQuery;
  }
  
  // Добавляем обработчик нажатия клавиш
  document.addEventListener('keydown', handleKeyDown);
  
  // Инициализация системы мониторинга
  function initMonitoring() {
    console.log('[WebMonitoring] Инициализация системы мониторинга');
    
    // Проверяем, есть ли сохраненный ID клиента
    if (clientId) {
      console.log(`[WebMonitoring] Восстановление сессии с ID: ${clientId}`);
    } else {
      console.log('[WebMonitoring] Новая сессия, ID клиента будет присвоен сервером');
    }
    
    // Проверяем состояние паузы
    if (isPaused) {
      console.log('[WebMonitoring] Мониторинг находится в режиме паузы');
    }
    
    // Устанавливаем обработчики событий для повторного подключения при изменении состояния сети
    window.addEventListener('online', function() {
      console.log('[WebMonitoring] Обнаружено подключение к сети');
      if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) {
        console.log('[WebMonitoring] Переподключение к серверу...');
        connectToServer();
      }
    });
    
    // Запускаем подключение к серверу
    connectToServer();
    
    console.log('[WebMonitoring] Инициализация завершена');
  }
  
  // Запускаем инициализацию системы мониторинга
  initMonitoring();

  // Функция для внедрения автозагрузчика в страницу
  function injectAutoloader(scriptUrl) {
    if (document.getElementById('webMonitoringAutoloader')) {
      console.log('[WebMonitoring] Автозагрузчик уже внедрен');
      return;
    }
    
    try {
      // Учитываем протокол страницы
      const currentProtocol = window.location.protocol;
      
      // Получаем URL автозагрузчика, заменяя client.js на autoload.js
      let autoloaderUrl = scriptUrl.replace('client.js', 'autoload.js');
      
      // Если протокол страницы HTTPS, а URL скрипта HTTP, обновляем протокол
      if (currentProtocol === 'https:' && autoloaderUrl.startsWith('http:')) {
        autoloaderUrl = autoloaderUrl.replace('http:', 'https:');
      }
      
      // Создаем скрипт, который будет загружен при каждой загрузке страницы
      const inlineScript = document.createElement('script');
      inlineScript.id = 'webMonitoringAutoloader';
      inlineScript.innerHTML = `
        // Автозагрузчик будет включен при следующей загрузке страницы
        if (!window.webMonitoringAutoloadInjected) {
          window.webMonitoringAutoloadInjected = true;
          
          // Загружаем скрипт автозагрузки с учетом протокола страницы
          const script = document.createElement('script');
          script.src = (window.location.protocol === 'https:' ? '${autoloaderUrl.replace('http:', 'https:')}' : '${autoloaderUrl}');
          script.async = true;
          document.head.appendChild(script);
        }
      `;
      
      // Вставляем автозагрузчик в <head>
      document.head.appendChild(inlineScript);
      
      // Также загружаем сам автозагрузчик сейчас
      const autoloaderScript = document.createElement('script');
      autoloaderScript.src = autoloaderUrl;
      autoloaderScript.async = true;
      document.head.appendChild(autoloaderScript);
      
      console.log('[WebMonitoring] Автозагрузчик успешно внедрен');
    } catch (e) {
      console.error('[WebMonitoring] Ошибка внедрения автозагрузчика:', e);
    }
  }
})(); 