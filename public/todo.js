// Todo и Помодоро - клиентский JavaScript

// Глобальные переменные
let todos = []; // Список всех задач
let timerInterval = null; // Интервал для таймера
let startTime = null; // Время старта таймера
let pausedTime = null; // Время паузы
let elapsedPausedTime = 0; // Общее время на паузе
let timerRunning = false; // Флаг работы таймера
let currentMode = 'pomodoro'; // Текущий режим таймера
let pomodoroCount = 0; // Счетчик завершенных помодоро
let currentUser = null; // Информация о текущем пользователе

// Конфигурация таймера
const defaultTimerConfig = {
  pomodoro: 25 * 60, // 25 минут
  'short-break': 5 * 60, // 5 минут
  'long-break': 15 * 60, // 15 минут
  'long-break-interval': 4, // Интервал длинного перерыва (после скольких помодоро)
  'auto-start-breaks': true, // Автоматически начинать перерывы
  'auto-start-pomodoros': true, // Автоматически начинать следующее помодоро
  'sound-enabled': true, // Включить звуковые уведомления
  'sound-volume': 80, // Громкость звука (0-100)
  'notification-sound': 'bell' // Тип звукового уведомления
};

// Актуальная конфигурация таймера (будет загружена из настроек пользователя)
let timerConfig = { ...defaultTimerConfig };

// Инициализация страницы
document.addEventListener('DOMContentLoaded', async () => {
  // Получение информации о текущем пользователе
  await getCurrentUser();
  
  // Загрузка настроек таймера (включает инициализацию таймера)
  await loadTimerSettings();
  
  // Загрузка задач
  loadTodos();
  
  // Инициализация обработчиков событий
  setupEventListeners();
  
  // Загрузка статистики
  loadStatistics();
});

// Получение информации о текущем пользователе
async function getCurrentUser() {
  try {
    const response = await fetch('/api/current-user');
    if (response.ok) {
      const newUser = await response.json();
      
      // Проверяем, сменился ли пользователь
      if (currentUser && currentUser.login !== newUser.login) {
        // Очищаем данные предыдущего пользователя
        handleUserChange(newUser);
      } else {
        currentUser = newUser;
        updateUserInfo();
      }
      
      console.log(`Загружена информация о пользователе: ${currentUser.login}`);
    } else {
      console.error('Ошибка получения информации о пользователе:', response.statusText);
    }
  } catch (error) {
    console.error('Ошибка получения информации о пользователе:', error);
  }
}

// Обработка смены пользователя
function handleUserChange(newUser) {
  console.log(`Смена пользователя: ${currentUser.login} -> ${newUser.login}`);
  
  // Сохраняем нового пользователя
  currentUser = newUser;
  
  // Обновляем информацию в интерфейсе
  updateUserInfo();
  
  // Сбрасываем глобальные переменные таймера
  timerRunning = false;
  startTime = null;
  pausedTime = null;
  elapsedPausedTime = 0;
  pomodoroCount = 0;
  
  // Обновляем отображение счетчика помодоро
  if (document.getElementById('pomodoro-count')) {
    document.getElementById('pomodoro-count').textContent = '0';
  }
  
  // Загружаем настройки таймера для нового пользователя
  loadTimerSettings();
  
  // Перезагружаем задачи и статистику
  loadTodos();
  loadStatistics();
}

// Обновление информации о пользователе в интерфейсе
function updateUserInfo() {
  const userNameElement = document.getElementById('current-user-name');
  if (userNameElement && currentUser) {
    userNameElement.textContent = currentUser.login;
  }
}

// Получение префикса для ключей localStorage
function getUserStoragePrefix() {
  return currentUser ? `user_${currentUser.login.toLowerCase()}_` : '';
}

// Сохранение в localStorage с учетом пользователя
function setUserStorage(key, value) {
  const prefixedKey = getUserStoragePrefix() + key;
  localStorage.setItem(prefixedKey, JSON.stringify(value));
}

// Получение из localStorage с учетом пользователя
function getUserStorage(key, defaultValue = null) {
  const prefixedKey = getUserStoragePrefix() + key;
  const value = localStorage.getItem(prefixedKey);
  return value ? JSON.parse(value) : defaultValue;
}

// Очистка localStorage для ключа с учетом пользователя
function clearUserStorage(key) {
  const prefixedKey = getUserStoragePrefix() + key;
  localStorage.removeItem(prefixedKey);
}

// Функция для загрузки задач с сервера
async function loadTodos() {
  try {
    const response = await fetch('/api/todos');
    if (response.ok) {
      todos = await response.json();
      renderTodos();
    } else {
      console.error('Ошибка загрузки задач:', response.statusText);
    }
  } catch (error) {
    console.error('Ошибка загрузки задач:', error);
  }
}

// Функция для отрисовки задач
function renderTodos() {
  const activeTodosList = document.getElementById('active-todos');
  const archivedTodosList = document.getElementById('archived-todos');
  
  // Очистка списков
  activeTodosList.innerHTML = '';
  archivedTodosList.innerHTML = '';
  
  // Сортировка задач по дате (сначала новые)
  const sortedTodos = [...todos].sort((a, b) => 
    new Date(b.createdAt) - new Date(a.createdAt)
  );
  
  // Разделение на активные и архивные
  const activeTodos = sortedTodos.filter(todo => !todo.completed);
  const archivedTodos = sortedTodos.filter(todo => todo.completed);
  
  // Отрисовка активных задач
  activeTodos.forEach(todo => {
    const li = createTodoElement(todo);
    activeTodosList.appendChild(li);
  });
  
  // Отрисовка архивных задач
  archivedTodos.forEach(todo => {
    const li = createTodoElement(todo);
    archivedTodosList.appendChild(li);
  });
}

// Создание элемента задачи
function createTodoElement(todo) {
  const li = document.createElement('li');
  li.className = 'todo-item';
  li.dataset.id = todo.id;
  
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'todo-checkbox';
  checkbox.checked = todo.completed;
  checkbox.disabled = todo.completed; // Если задача в архиве, чекбокс становится disabled
  
  // Обработчик чекбокса
  checkbox.addEventListener('change', async () => {
    if (checkbox.checked) {
      await toggleTodoStatus(todo.id, true);
    }
  });
  
  const textSpan = document.createElement('span');
  textSpan.className = 'todo-text';
  textSpan.textContent = todo.text;
  
  // Если задача завершена, добавляем стиль перечеркивания
  if (todo.completed) {
    textSpan.style.textDecoration = 'line-through';
    textSpan.style.color = 'var(--gray)';
  }
  
  const dateSpan = document.createElement('span');
  dateSpan.className = 'todo-date';
  dateSpan.textContent = formatDate(new Date(todo.createdAt));
  
  li.appendChild(checkbox);
  li.appendChild(textSpan);
  li.appendChild(dateSpan);
  
  return li;
}

// Форматирование даты
function formatDate(date) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

// Добавление новой задачи
async function addTodo(text) {
  if (!text.trim()) return;
  
  const newTodo = {
    id: generateUniqueId(),
    text: text.trim(),
    completed: false,
    createdAt: new Date().toISOString(),
    completedAt: null
  };
  
  try {
    const response = await fetch('/api/todos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(newTodo)
    });
    
    if (response.ok) {
      todos.push(newTodo);
      renderTodos();
      updateTodosStatistics();
    } else {
      console.error('Ошибка добавления задачи:', response.statusText);
    }
  } catch (error) {
    console.error('Ошибка добавления задачи:', error);
  }
}

// Изменение статуса задачи
async function toggleTodoStatus(id, completed) {
  try {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    
    const updatedTodo = {
      ...todo,
      completed,
      completedAt: completed ? new Date().toISOString() : null
    };
    
    const response = await fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ completed, completedAt: updatedTodo.completedAt })
    });
    
    if (response.ok) {
      // Обновляем задачу в локальном массиве
      const index = todos.findIndex(t => t.id === id);
      if (index !== -1) {
        todos[index] = updatedTodo;
        renderTodos();
        updateTodosStatistics();
      }
    } else {
      console.error('Ошибка обновления задачи:', response.statusText);
    }
  } catch (error) {
    console.error('Ошибка обновления задачи:', error);
  }
}

// Генерация уникального ID
function generateUniqueId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// Установка обработчиков событий
function setupEventListeners() {
  // Обработчик добавления задачи
  const addButton = document.getElementById('add-todo');
  const newTodoInput = document.getElementById('new-todo');
  
  addButton.addEventListener('click', () => {
    addTodo(newTodoInput.value);
    newTodoInput.value = '';
  });
  
  newTodoInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addTodo(newTodoInput.value);
      newTodoInput.value = '';
    }
  });
  
  // Обработчики таймера
  const startButton = document.getElementById('start-timer');
  const pauseButton = document.getElementById('pause-timer');
  const resetButton = document.getElementById('reset-timer');
  
  startButton.addEventListener('click', startTimer);
  pauseButton.addEventListener('click', pauseTimer);
  resetButton.addEventListener('click', resetTimer);
  
  // Обработчики режимов таймера
  document.querySelectorAll('.timer-mode').forEach(mode => {
    mode.addEventListener('click', () => {
      const selectedMode = mode.dataset.mode;
      switchTimerMode(selectedMode);
    });
  });
  
  // Обработчик сохранения настроек
  const saveSettingsButton = document.getElementById('save-settings');
  if (saveSettingsButton) {
    saveSettingsButton.addEventListener('click', saveTimerSettings);
  }
  
  // Обработчики изменения настроек для предпросмотра
  document.getElementById('sound-enabled').addEventListener('change', function() {
    // Ничего не делаем, настройка будет применена при сохранении
  });
  
  document.getElementById('sound-volume').addEventListener('input', function(e) {
    // При изменении громкости показываем текущее значение и воспроизводим тестовый звук
    const volumeValue = e.target.value;
    
    // Обновляем отображение громкости
    document.getElementById('volume-display').textContent = `${volumeValue}%`;
    
    // Временно меняем громкость для демонстрации
    const originalVolume = timerConfig['sound-volume'];
    timerConfig['sound-volume'] = volumeValue;
    
    // Воспроизводим звук с новой громкостью
    if (timerConfig['sound-enabled']) {
      playPreviewSound(timerConfig['notification-sound']);
    }
    
    // Возвращаем оригинальную настройку
    timerConfig['sound-volume'] = originalVolume;
  });
  
  document.getElementById('notification-sound').addEventListener('change', function(e) {
    // Воспроизводим выбранный звук для предпросмотра
    const selectedSound = e.target.value;
    
    // Воспроизводим звук с текущей громкостью
    if (timerConfig['sound-enabled']) {
      playPreviewSound(selectedSound);
    }
  });
  
  // Функция для предпросмотра звука
  function playPreviewSound(soundType) {
    // Проверяем, включены ли звуки в настройках
    if (!timerConfig['sound-enabled']) return;
    
    // Получаем громкость
    const volume = timerConfig['sound-volume'] / 100;
    
    try {
      // Создаем аудио-контекст
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContext();
      
      // Создаем осциллятор (генератор звука)
      const oscillator = audioCtx.createOscillator();
      
      // Создаем усилитель для управления громкостью
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = volume;
      
      // Соединяем осциллятор с усилителем, а усилитель с выходом
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      // Настраиваем тип звука
      switch (soundType) {
        case 'bell':
          // Звук колокольчика
          oscillator.type = 'sine';
          oscillator.frequency.value = 830;
          oscillator.start();
          
          // Создаем затухание звука
          gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
          
          // Останавливаем через 0.5 секунды (для предпросмотра короче)
          setTimeout(() => {
            oscillator.stop();
          }, 500);
          break;
          
        case 'digital':
          // Цифровой звук
          oscillator.type = 'square';
          oscillator.frequency.value = 440;
          oscillator.start();
          
          // Изменяем частоту для создания эффекта
          oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);
          oscillator.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.2);
          
          // Создаем затухание звука
          gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
          
          // Останавливаем через 0.3 секунды
          setTimeout(() => {
            oscillator.stop();
          }, 300);
          break;
          
        case 'simple':
        default:
          // Простой звук
          oscillator.type = 'sine';
          oscillator.frequency.value = 660;
          oscillator.start();
          
          // Создаем затухание звука
          gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
          
          // Останавливаем через 0.3 секунды
          setTimeout(() => {
            oscillator.stop();
          }, 300);
          break;
      }
    } catch (error) {
      console.error('Ошибка воспроизведения тестового звука:', error);
    }
  }
  
  // Обработчик выхода (для сохранения статистики)
  const logoutButton = document.getElementById('logout-btn');
  if (logoutButton) {
    logoutButton.addEventListener('click', () => {
      saveTimerState();
    });
  }
  
  // Обработчик закрытия окна или переключения вкладки
  window.addEventListener('beforeunload', () => {
    saveTimerState();
  });
  
  // Обработчик видимости страницы для таймера
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Если вкладка снова активна, обновляем таймер
      if (timerRunning) {
        updateTimerDisplay();
      }
    }
  });
}

// Инициализация таймера
function initializeTimer() {
  // Загрузка сохраненного состояния таймера
  const savedState = getUserStorage('pomodoroState', {});
  
  // Восстановление счетчика помодоро
  pomodoroCount = savedState.pomodoroCount || 0;
  document.getElementById('pomodoro-count').textContent = pomodoroCount;
  
  // Восстановление режима таймера
  if (savedState.currentMode) {
    currentMode = savedState.currentMode;
    // Обновляем активную кнопку режима
    document.querySelectorAll('.timer-mode').forEach(el => {
      if (el.dataset.mode === currentMode) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });
  }
  
  // Восстановление состояния таймера
  if (savedState.timerRunning) {
    startTime = savedState.startTime ? new Date(savedState.startTime) : null;
    pausedTime = savedState.pausedTime ? new Date(savedState.pausedTime) : null;
    elapsedPausedTime = savedState.elapsedPausedTime || 0;
    
    if (startTime && !pausedTime) {
      // Если таймер был запущен и не на паузе
      resumeTimer();
    } else {
      // Если таймер был на паузе, показываем оставшееся время
      updateTimerDisplay();
    }
  } else {
    // Если таймер не был запущен, показываем время для текущего режима
    resetTimer();
  }
}

// Запуск таймера
function startTimer() {
  if (timerRunning) return;
  
  // Если таймер был на паузе
  if (pausedTime) {
    // Рассчитываем время на паузе
    elapsedPausedTime += (new Date() - pausedTime);
    pausedTime = null;
  } else {
    // Новый запуск таймера
    startTime = new Date();
    elapsedPausedTime = 0;
  }
  
  timerRunning = true;
  document.getElementById('start-timer').disabled = true;
  document.getElementById('pause-timer').disabled = false;
  
  // Запуск интервала обновления
  timerInterval = setInterval(updateTimerDisplay, 1000);
  
  // Сохранение состояния
  saveTimerState();
}

// Продолжение таймера после перезагрузки страницы
function resumeTimer() {
  timerRunning = true;
  document.getElementById('start-timer').disabled = true;
  document.getElementById('pause-timer').disabled = false;
  
  // Запуск интервала обновления
  timerInterval = setInterval(updateTimerDisplay, 1000);
}

// Пауза таймера
function pauseTimer() {
  if (!timerRunning) return;
  
  clearInterval(timerInterval);
  timerRunning = false;
  pausedTime = new Date();
  
  document.getElementById('start-timer').disabled = false;
  document.getElementById('pause-timer').disabled = true;
  
  // Сохранение состояния
  saveTimerState();
}

// Сброс таймера
function resetTimer() {
  clearInterval(timerInterval);
  timerRunning = false;
  startTime = null;
  pausedTime = null;
  elapsedPausedTime = 0;
  
  document.getElementById('start-timer').disabled = false;
  document.getElementById('pause-timer').disabled = true;
  
  // Обновление отображения таймера с учетом текущих настроек
  const totalSeconds = timerConfig[currentMode];
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  document.getElementById('timer').textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  
  // Возвращаем исходный заголовок вкладки
  document.title = 'ToDo список и Помодоро - Система мониторинга';
  
  // Сохранение состояния
  saveTimerState();
}

// Обновление отображения таймера
function updateTimerDisplay() {
  if (!startTime) return;
  
  // Рассчитываем прошедшее время с учетом пауз
  const now = new Date();
  const elapsedMilliseconds = now - startTime - elapsedPausedTime;
  const elapsedSeconds = Math.floor(elapsedMilliseconds / 1000);
  
  // Получаем общее время для текущего режима
  const totalSeconds = timerConfig[currentMode];
  
  // Рассчитываем оставшееся время
  let remainingSeconds = totalSeconds - elapsedSeconds;
  
  // Если время истекло
  if (remainingSeconds <= 0) {
    // Останавливаем таймер
    clearInterval(timerInterval);
    timerRunning = false;
    
    // Если завершен помодоро (не перерыв), увеличиваем счетчик
    if (currentMode === 'pomodoro') {
      pomodoroCount++;
      document.getElementById('pomodoro-count').textContent = pomodoroCount;
      
      // Сохраняем статистику помодоро
      savePomodoroStatistics();
    }
    
    // Звуковое уведомление (если включено)
    if (timerConfig['sound-enabled']) {
      playNotificationSound();
    }
    
    // Показываем уведомление
    if (Notification.permission === 'granted') {
      const title = currentMode === 'pomodoro' ? 'Время работы закончилось!' : 'Перерыв окончен!';
      const message = currentMode === 'pomodoro' ? 'Пора сделать перерыв' : 'Пора вернуться к работе';
      
      new Notification(title, {
        body: message,
        icon: '/favicon.ico'
      });
    }
    
    // Автоматическое переключение режима
    if (currentMode === 'pomodoro') {
      // После помодоро переключаемся на короткий перерыв
      // Или на длинный после заданного количества помодоро
      const longBreakInterval = timerConfig['long-break-interval'] || 4;
      const nextMode = pomodoroCount % longBreakInterval === 0 ? 'long-break' : 'short-break';
      
      // Если включен автозапуск перерывов
      if (timerConfig['auto-start-breaks']) {
        switchTimerMode(nextMode, true);
        startTimer();
      } else {
        switchTimerMode(nextMode, true);
      }
    } else {
      // После перерыва переключаемся на помодоро
      switchTimerMode('pomodoro', true);
      
      // Если включен автозапуск помодоро
      if (timerConfig['auto-start-pomodoros']) {
        startTimer();
      }
    }
    
    return;
  }
  
  // Обновляем отображение таймера
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  document.getElementById('timer').textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  
  // Обновляем заголовок вкладки
  document.title = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} - ToDo и Помодоро`;
  
  // Сохранение состояния
  if (remainingSeconds % 10 === 0) { // Для снижения нагрузки сохраняем раз в 10 секунд
    saveTimerState();
  }
}

// Переключение режима таймера
function switchTimerMode(mode, resetCurrentTimer = true) {
  if (!timerConfig[mode]) return;
  
  // Обновляем визуальное состояние
  document.querySelectorAll('.timer-mode').forEach(el => {
    if (el.dataset.mode === mode) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
  
  // Обновляем текущий режим
  currentMode = mode;
  
  // Если нужно сбросить таймер
  if (resetCurrentTimer) {
    resetTimer();
  }
  
  // Сохранение состояния
  saveTimerState();
}

// Воспроизведение звукового уведомления
function playNotificationSound() {
  // Проверяем, включены ли звуки в настройках
  if (!timerConfig['sound-enabled']) return;
  
  // Получаем выбранный тип звука и громкость
  const soundType = timerConfig['notification-sound'];
  const volume = timerConfig['sound-volume'] / 100;
  
  try {
    // Создаем аудио-контекст
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioContext();
    
    // Создаем осциллятор (генератор звука)
    const oscillator = audioCtx.createOscillator();
    
    // Создаем усилитель для управления громкостью
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = volume;
    
    // Соединяем осциллятор с усилителем, а усилитель с выходом
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    // Настраиваем тип звука
    switch (soundType) {
      case 'bell':
        // Звук колокольчика
        oscillator.type = 'sine';
        oscillator.frequency.value = 830;
        oscillator.start();
        
        // Создаем затухание звука
        gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1.5);
        
        // Останавливаем через 1.5 секунды
        setTimeout(() => {
          oscillator.stop();
        }, 1500);
        break;
        
      case 'digital':
        // Цифровой звук
        oscillator.type = 'square';
        oscillator.frequency.value = 440;
        oscillator.start();
        
        // Изменяем частоту для создания эффекта
        oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.2);
        
        // Создаем затухание звука
        gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        
        // Останавливаем через 0.3 секунды
        setTimeout(() => {
          oscillator.stop();
        }, 300);
        break;
        
      case 'simple':
      default:
        // Простой звук
        oscillator.type = 'sine';
        oscillator.frequency.value = 660;
        oscillator.start();
        
        // Создаем затухание звука
        gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
        
        // Останавливаем через 0.5 секунды
        setTimeout(() => {
          oscillator.stop();
        }, 500);
        break;
    }
  } catch (error) {
    console.error('Ошибка воспроизведения звука:', error);
  }
}

// Сохранение состояния таймера
function saveTimerState() {
  const state = {
    startTime: startTime ? startTime.toISOString() : null,
    pausedTime: pausedTime ? pausedTime.toISOString() : null,
    elapsedPausedTime,
    timerRunning,
    currentMode,
    pomodoroCount
  };
  
  setUserStorage('pomodoroState', state);
}

// Запрос разрешения на уведомления
function requestNotificationPermission() {
  if (Notification && Notification.permission !== 'granted') {
    Notification.requestPermission();
  }
}

// Сохранение статистики помодоро
async function savePomodoroStatistics() {
  const today = new Date().toISOString().split('T')[0];
  
  try {
    // Получаем текущую статистику с сервера
    const response = await fetch('/api/pomodoro-stats');
    let stats = {};
    
    if (response.ok) {
      stats = await response.json();
    }
    
    // Обновляем статистику
    if (!stats[today]) {
      stats[today] = 0;
    }
    stats[today]++;
    
    // Сохраняем обновленную статистику на сервере
    await fetch('/api/pomodoro-stats', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(stats)
    });
    
    // Обновляем отображение статистики
    updatePomodoroStatistics(stats);
  } catch (error) {
    console.error('Ошибка сохранения статистики помодоро:', error);
  }
}

// Загрузка статистики
async function loadStatistics() {
  try {
    // Загрузка статистики помодоро
    const pomodoroResponse = await fetch('/api/pomodoro-stats');
    if (pomodoroResponse.ok) {
      const pomodoroStats = await pomodoroResponse.json();
      updatePomodoroStatistics(pomodoroStats);
    }
    
    // Обновляем статистику задач
    updateTodosStatistics();
  } catch (error) {
    console.error('Ошибка загрузки статистики:', error);
  }
}

// Обновление статистики задач
function updateTodosStatistics() {
  // Группируем задачи по датам создания и завершения
  const todoStats = {};
  
  todos.forEach(todo => {
    // Дата создания
    const createdDate = new Date(todo.createdAt).toISOString().split('T')[0];
    if (!todoStats[createdDate]) {
      todoStats[createdDate] = { created: 0, completed: 0 };
    }
    todoStats[createdDate].created++;
    
    // Дата завершения
    if (todo.completed && todo.completedAt) {
      const completedDate = new Date(todo.completedAt).toISOString().split('T')[0];
      if (!todoStats[completedDate]) {
        todoStats[completedDate] = { created: 0, completed: 0 };
      }
      todoStats[completedDate].completed++;
    }
  });
  
  // Обновляем тепловую карту активности
  renderTodosHeatmap(todoStats);
}

// Обновление статистики помодоро
function updatePomodoroStatistics(stats) {
  renderPomodoroChart(stats);
}

// Отрисовка тепловой карты задач
function renderTodosHeatmap(data) {
  const heatmapContainer = document.getElementById('todos-heatmap');
  heatmapContainer.innerHTML = '';
  
  // Создаем контейнер для тепловой карты
  const heatmapGrid = document.createElement('div');
  heatmapGrid.className = 'heatmap-container';
  
  // Получаем диапазон дат (последние 365 дней)
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 364);
  
  // Создаем ячейки для каждого дня
  let currentDate = new Date(startDate);
  
  while (currentDate <= today) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const dayData = data[dateStr] || { created: 0, completed: 0 };
    
    // Определяем уровень активности (0-4)
    const activityLevel = getActivityLevel(dayData.created + dayData.completed);
    
    const dayEl = document.createElement('div');
    dayEl.className = 'heatmap-day';
    dayEl.dataset.date = dateStr;
    dayEl.dataset.level = activityLevel;
    dayEl.title = `${dateStr}: ${dayData.created} создано, ${dayData.completed} выполнено`;
    
    heatmapGrid.appendChild(dayEl);
    
    // Переходим к следующему дню
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  heatmapContainer.appendChild(heatmapGrid);
}

// Определение уровня активности для тепловой карты
function getActivityLevel(count) {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  return 4;
}

// Отрисовка графика помодоро
function renderPomodoroChart(data) {
  const ctx = document.getElementById('pomodoro-chart');
  
  // Если график уже существует, уничтожаем его
  if (window.pomodoroChart) {
    window.pomodoroChart.destroy();
  }
  
  // Подготавливаем данные для графика
  const last30Days = [];
  const today = new Date();
  
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    last30Days.push({
      date: dateStr,
      count: data[dateStr] || 0
    });
  }
  
  // Создаем новый график
  window.pomodoroChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: last30Days.map(d => {
        const date = new Date(d.date);
        return `${date.getDate()}.${date.getMonth() + 1}`;
      }),
      datasets: [{
        label: 'Количество помодоро',
        data: last30Days.map(d => d.count),
        backgroundColor: 'rgba(74, 107, 175, 0.7)',
        borderColor: 'rgba(74, 107, 175, 1)',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            precision: 0 // Только целые числа
          }
        }
      }
    }
  });
}

// Загрузка настроек таймера
async function loadTimerSettings() {
  try {
    // Сначала пытаемся загрузить настройки с сервера
    const response = await fetch('/api/pomodoro-settings');
    
    if (response.ok) {
      // Если с сервера успешно загружены настройки, используем их
      const serverSettings = await response.json();
      timerConfig = { ...defaultTimerConfig, ...serverSettings };
      console.log('Загружены настройки таймера с сервера');
    } else {
      // Если с сервера не удалось загрузить настройки, пробуем из localStorage
      const savedSettings = getUserStorage('pomodoroSettings', null);
      
      if (savedSettings) {
        // Если есть настройки в localStorage
        timerConfig = { ...defaultTimerConfig, ...savedSettings };
        console.log('Загружены локальные настройки таймера');
        
        // И отправляем их на сервер для синхронизации
        await fetch('/api/pomodoro-settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(timerConfig)
        });
      } else {
        // Если нигде нет настроек, используем значения по умолчанию
        timerConfig = { ...defaultTimerConfig };
        console.log('Используются настройки таймера по умолчанию');
      }
    }
  } catch (error) {
    console.error('Ошибка загрузки настроек таймера:', error);
    
    // При ошибке пробуем загрузить из localStorage
    const savedSettings = getUserStorage('pomodoroSettings', null);
    
    if (savedSettings) {
      timerConfig = { ...defaultTimerConfig, ...savedSettings };
      console.log('Загружены локальные настройки таймера после ошибки');
    } else {
      timerConfig = { ...defaultTimerConfig };
      console.log('Используются настройки таймера по умолчанию после ошибки');
    }
  } finally {
    // Обновляем интерфейс настроек
    updateSettingsUI();
    
    // Если таймер не запущен, переинициализируем его
    initializeTimer();
  }
}

// Обновление интерфейса настроек
function updateSettingsUI() {
  // Длительность
  document.getElementById('pomodoro-duration').value = Math.floor(timerConfig.pomodoro / 60);
  document.getElementById('short-break-duration').value = Math.floor(timerConfig['short-break'] / 60);
  document.getElementById('long-break-duration').value = Math.floor(timerConfig['long-break'] / 60);
  document.getElementById('long-break-interval').value = timerConfig['long-break-interval'];
  
  // Автоматизация
  document.getElementById('auto-start-breaks').checked = timerConfig['auto-start-breaks'];
  document.getElementById('auto-start-pomodoros').checked = timerConfig['auto-start-pomodoros'];
  
  // Уведомления
  document.getElementById('sound-enabled').checked = timerConfig['sound-enabled'];
  document.getElementById('sound-volume').value = timerConfig['sound-volume'];
  document.getElementById('notification-sound').value = timerConfig['notification-sound'];
  
  // Обновляем отображение громкости
  document.getElementById('volume-display').textContent = `${timerConfig['sound-volume']}%`;
}

// Сохранение настроек таймера
async function saveTimerSettings() {
  // Получаем значения из интерфейса
  const newSettings = {
    pomodoro: parseInt(document.getElementById('pomodoro-duration').value) * 60,
    'short-break': parseInt(document.getElementById('short-break-duration').value) * 60,
    'long-break': parseInt(document.getElementById('long-break-duration').value) * 60,
    'long-break-interval': parseInt(document.getElementById('long-break-interval').value),
    'auto-start-breaks': document.getElementById('auto-start-breaks').checked,
    'auto-start-pomodoros': document.getElementById('auto-start-pomodoros').checked,
    'sound-enabled': document.getElementById('sound-enabled').checked,
    'sound-volume': parseInt(document.getElementById('sound-volume').value),
    'notification-sound': document.getElementById('notification-sound').value
  };
  
  // Валидация значений
  if (newSettings.pomodoro < 60) newSettings.pomodoro = 60; // Минимум 1 минута
  if (newSettings['short-break'] < 60) newSettings['short-break'] = 60;
  if (newSettings['long-break'] < 60) newSettings['long-break'] = 60;
  if (newSettings['long-break-interval'] < 1) newSettings['long-break-interval'] = 1;
  
  // Обновляем конфигурацию
  timerConfig = { ...newSettings };
  
  try {
    // Сохраняем на сервере
    const response = await fetch('/api/pomodoro-settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(timerConfig)
    });
    
    if (response.ok) {
      console.log('Настройки таймера сохранены на сервере');
    } else {
      console.warn('Не удалось сохранить настройки на сервере:', await response.text());
    }
  } catch (error) {
    console.error('Ошибка при сохранении настроек на сервере:', error);
  }
  
  // В любом случае сохраняем локально
  setUserStorage('pomodoroSettings', timerConfig);
  
  // Если таймер не запущен, обновляем отображение таймера
  if (!timerRunning) {
    resetTimer();
  }
  
  // Уведомление пользователя
  showNotification('Настройки сохранены');
  
  console.log('Настройки таймера сохранены:', timerConfig);
  
  return timerConfig;
}

// Показать уведомление
function showNotification(message, type = 'success') {
  // Создаем элемент уведомления
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  
  // Добавляем уведомление в DOM
  document.body.appendChild(notification);
  
  // Анимация появления
  setTimeout(() => {
    notification.classList.add('show');
  }, 10);
  
  // Удаляем уведомление через 3 секунды
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 300);
  }, 3000);
}

// Запрашиваем разрешение на уведомления при загрузке страницы
requestNotificationPermission(); 