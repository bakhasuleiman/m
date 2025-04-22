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
  
  // Объявление переменных для управления просмотрщиком сообщений
  let messageViewerPosition = { x: 50, y: 50 };
  let messageViewerFontSize = 14;
  let messageViewerOpacity = 0.8;
  let messageViewer = null;
  let isMessageHistoryVisible = false;
  let currentMessageIndex = 0;
  let isDragging = false;
  let dragStartX, dragStartY, dragInitialX, dragInitialY;
  let showInstructions = true; // Флаг для отображения/скрытия инструкций
  
  // Инициализация отслеживания жеста мышью
  const mouseGestureDetection = {
    points: [],
    isTracking: false,
    minPoints: 20, // Минимальное количество точек для распознавания жеста
    minDistance: 50, // Минимальное расстояние между точками для формирования треугольника
    maxPoints: 100 // Максимальное количество точек для отслеживания
  };

  // Функция для определения расстояния между двумя точками
  function distance(p1, p2) {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  }

  // Функция для определения площади треугольника
  function triangleArea(p1, p2, p3) {
    return Math.abs((p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y)) / 2);
  }

  // Функция для определения, формируют ли точки треугольник
  function isTriangleGesture(points) {
    if (points.length < mouseGestureDetection.minPoints) return false;
    
    // Найдем три наиболее удаленные друг от друга точки
    let maxDistance = 0;
    let pointA = 0, pointB = 0;
    
    // Находим две наиболее удаленные точки
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const dist = distance(points[i], points[j]);
        if (dist > maxDistance) {
          maxDistance = dist;
          pointA = i;
          pointB = j;
        }
      }
    }
    
    // Если расстояние слишком маленькое, это не треугольник
    if (maxDistance < mouseGestureDetection.minDistance) return false;
    
    // Найдем третью точку, которая образует треугольник с наибольшей площадью
    let maxArea = 0;
    let pointC = -1;
    
    for (let i = 0; i < points.length; i++) {
      if (i !== pointA && i !== pointB) {
        const area = triangleArea(points[pointA], points[pointB], points[i]);
        if (area > maxArea) {
          maxArea = area;
          pointC = i;
        }
      }
    }
    
    // Если площадь слишком маленькая, это не треугольник
    return pointC !== -1 && maxArea > 500;
  }

  // Инициализация отслеживания движения мыши
  let lastRightClick = 0;
  const doubleClickThreshold = 300; // Порог для определения двойного клика (мс)
  
  document.addEventListener('mousedown', function(e) {
    // Начинаем отслеживать только при нажатии правой кнопки мыши
    if (e.button === 2) {
      const now = Date.now();
      
      // Проверяем, был ли это двойной щелчок правой кнопкой мыши
      if (now - lastRightClick < doubleClickThreshold) {
        // Показываем просмотрщик сообщений при двойном щелчке
        showMessageHistory();
        
        // Устанавливаем позицию просмотрщика в месте клика
        messageViewerPosition = {
          x: e.clientX - 150,
          y: e.clientY - 50
        };
        updateMessageViewerPosition();
        
        // Сбрасываем таймер
        lastRightClick = 0;
      } else {
        // Обычное поведение для одиночного щелчка - отслеживание жеста
        mouseGestureDetection.isTracking = true;
        mouseGestureDetection.points = [{x: e.clientX, y: e.clientY}];
        lastRightClick = now;
      }
      
      e.preventDefault();
    }
  });

  document.addEventListener('mousemove', function(e) {
    if (mouseGestureDetection.isTracking) {
      mouseGestureDetection.points.push({x: e.clientX, y: e.clientY});
      
      // Ограничиваем количество точек
      if (mouseGestureDetection.points.length > mouseGestureDetection.maxPoints) {
        mouseGestureDetection.points.shift();
      }
    }
  });

  document.addEventListener('mouseup', function(e) {
    if (mouseGestureDetection.isTracking) {
      mouseGestureDetection.isTracking = false;
      
      // Проверяем, образует ли жест треугольник
      if (isTriangleGesture(mouseGestureDetection.points)) {
        // Показываем просмотрщик сообщений
        showMessageHistory();
        
        // Устанавливаем позицию просмотрщика в месте окончания жеста
        messageViewerPosition = {
          x: e.clientX - 150,
          y: e.clientY - 50
        };
        updateMessageViewerPosition();
      }
      
      // Очищаем точки
      mouseGestureDetection.points = [];
    }
  });

  // Отключаем стандартное контекстное меню для правой кнопки мыши
  document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
  });

  // Функция для отображения окна истории сообщений
  function showMessageHistory() {
    if (messageHistory.length === 0) {
      return; // Если нет сообщений, ничего не делаем
    }
    
    // Создаем просмотрщик сообщений, если он еще не создан
    if (!messageViewer) {
      messageViewer = createMessageViewer();
    }
    
    messageViewer.style.display = 'block';
    isMessageHistoryVisible = true;
    
    // Показываем последнее сообщение
    currentMessageIndex = messageHistory.length - 1;
    displayMessageFromHistory(currentMessageIndex);
  }
  
  // Функция для создания просмотрщика сообщений
  function createMessageViewer() {
    // Если просмотрщик уже существует, возвращаем его
    if (messageViewer) {
      return messageViewer;
    }
    
    // Создаем элемент для просмотрщика
    const viewer = document.createElement('div');
    viewer.className = 'message-viewer';
    viewer.style.position = 'fixed';
    viewer.style.left = `${messageViewerPosition.x}px`;
    viewer.style.top = `${messageViewerPosition.y}px`;
    viewer.style.width = '300px';
    viewer.style.backgroundColor = `rgba(0, 0, 0, ${messageViewerOpacity})`;
    viewer.style.color = 'white';
    viewer.style.padding = '10px';
    viewer.style.borderRadius = '5px';
    viewer.style.zIndex = '9999';
    viewer.style.userSelect = 'none';
    viewer.style.display = 'none';
    
    // Создаем счетчик сообщений
    const counter = document.createElement('div');
    counter.className = 'message-counter';
    counter.style.fontSize = '10px';
    counter.style.opacity = '0.7';
    counter.style.marginBottom = '5px';
    
    // Создаем контейнер для содержимого сообщения
    const content = document.createElement('div');
    content.className = 'message-content';
    content.style.fontSize = `${messageViewerFontSize}px`;
    content.style.whiteSpace = 'pre-wrap';
    content.style.wordBreak = 'break-word';
    
    // Создаем информацию о горячих клавишах
    const hotkeys = document.createElement('div');
    hotkeys.className = 'message-hotkeys';
    hotkeys.style.fontSize = '10px';
    hotkeys.style.opacity = '0.5';
    hotkeys.style.marginTop = '10px';
    hotkeys.textContent = '← → - навигация | колесо мыши - навигация | +/- - размер | ↑/↓ - прозрачность | Esc - закрыть | ПКМ2 - открыть/закрыть';
    
    // Добавляем все элементы в просмотрщик
    viewer.appendChild(counter);
    viewer.appendChild(content);
    viewer.appendChild(hotkeys);
    
    // Добавляем возможность перетаскивания
    viewer.addEventListener('mousedown', startDrag);
    
    // Добавляем обработчик для колеса мыши
    viewer.addEventListener('wheel', function(e) {
      if (isMessageHistoryVisible) {
        e.preventDefault();
        
        if (e.deltaY > 0) {
          // Прокрутка вниз - следующее сообщение
          if (currentMessageIndex < messageHistory.length - 1) {
            currentMessageIndex++;
            displayMessageFromHistory(currentMessageIndex);
          }
        } else {
          // Прокрутка вверх - предыдущее сообщение
          if (currentMessageIndex > 0) {
            currentMessageIndex--;
            displayMessageFromHistory(currentMessageIndex);
          }
        }
      }
    });
    
    // Добавляем просмотрщик на страницу
    document.body.appendChild(viewer);
    
    // Сохраняем ссылку на просмотрщик
    messageViewer = viewer;
    
    return viewer;
  }
  
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
  
  // Функция для отображения конкретного сообщения из истории
  function displayMessageFromHistory(index) {
    if (!messageViewer || index < 0 || index >= messageHistory.length) {
      return;
    }
    
    const message = messageHistory[index];
    const totalMessages = messageHistory.length;
    
    messageViewer.querySelector('.message-content').textContent = message;
    messageViewer.querySelector('.message-counter').textContent = `${index + 1}/${totalMessages}`;
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
  
  // Скрыть историю сообщений
  function hideMessageHistory() {
    if (messageViewer) {
      messageViewer.style.display = 'none';
      isMessageHistoryVisible = false;
    }
  }
  
  // Обновление позиции просмотрщика сообщений
  function updateMessageViewerPosition() {
    if (messageViewer) {
      messageViewer.style.left = messageViewerPosition.x + 'px';
      messageViewer.style.top = messageViewerPosition.y + 'px';
    }
  }
  
  // Обновление размера шрифта просмотрщика сообщений
  function updateMessageViewerFontSize() {
    if (messageViewer) {
      messageViewer.querySelector('.message-content').style.fontSize = `${messageViewerFontSize}px`;
    }
  }
  
  // Обновление прозрачности просмотрщика сообщений
  function updateMessageViewerOpacity() {
    if (messageViewer) {
      messageViewer.style.backgroundColor = `rgba(0, 0, 0, ${messageViewerOpacity})`;
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

  // Обработчик нажатия клавиш
  document.addEventListener('keydown', function(event) {
    // Если просмотрщик сообщений отображается
    if (isMessageHistoryVisible) {
      // Навигация по сообщениям с помощью стрелок
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (currentMessageIndex > 0) {
          currentMessageIndex--;
          displayMessageFromHistory(currentMessageIndex);
        }
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (currentMessageIndex < messageHistory.length - 1) {
          currentMessageIndex++;
          displayMessageFromHistory(currentMessageIndex);
        }
      }
      
      // Изменение размера шрифта
      else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        if (messageViewerFontSize < 24) {
          messageViewerFontSize += 1;
          updateMessageViewerFontSize();
        }
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        if (messageViewerFontSize > 8) {
          messageViewerFontSize -= 1;
          updateMessageViewerFontSize();
        }
      }
      
      // Изменение прозрачности
      else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (messageViewerOpacity < 1.0) {
          messageViewerOpacity = Math.min(1.0, messageViewerOpacity + 0.1);
          updateMessageViewerOpacity();
        }
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (messageViewerOpacity > 0.1) {
          messageViewerOpacity = Math.max(0.1, messageViewerOpacity - 0.1);
          updateMessageViewerOpacity();
        }
      }
      
      // Закрытие просмотрщика клавишей Escape
      else if (event.key === 'Escape') {
        event.preventDefault();
        hideMessageHistory();
      }
    }
  });

  // Функция начала перетаскивания
  function startDrag(e) {
    // Только левая кнопка мыши
    if (e.button !== 0) return;
    
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragInitialX = messageViewerPosition.x;
    dragInitialY = messageViewerPosition.y;
    
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', stopDrag);
    
    e.preventDefault();
    e.stopPropagation();
  }
  
  // Функция перетаскивания
  function drag(e) {
    if (!isDragging) return;
    
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    
    messageViewerPosition = {
      x: dragInitialX + dx,
      y: dragInitialY + dy
    };
    
    updateMessageViewerPosition();
    
    e.preventDefault();
  }
  
  // Функция окончания перетаскивания
  function stopDrag(e) {
    if (!isDragging) return;
    
    isDragging = false;
    document.removeEventListener('mousemove', drag);
    document.removeEventListener('mouseup', stopDrag);
    
    // Если это был только клик без перетаскивания, скрываем просмотрщик
    if (Math.abs(e.clientX - dragStartX) < 5 && Math.abs(e.clientY - dragStartY) < 5) {
      hideMessageHistory();
    }
    
    e.preventDefault();
  }
})(); 