const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
// Добавляем поддержку .env файла
require('dotenv').config();
// Импортируем GitHubDBManager
const dbManager = require('./github-db-manager');

// Функция для хеширования пароля с использованием SHA-256
function hashPassword(password, salt) {
  return crypto.createHmac('sha256', salt)
    .update(password)
    .digest('hex');
}

// Константы для аутентификации
const ADMIN_PASSWORD = 'Z6489092Akumi!s@'; // Установленный пароль
const ADMIN_LOGIN = 'Mrak'; // Логин администратора
const SALT = 'f8a3j2k4l9z7m5n6'; // Соль для хеширования (в реальном проекте должна быть защищена)
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 часа
// Добавляем константу времени ожидания переподключения (30 секунд)
const reconnectTimeout = 30000;

// Хеширование пароля администратора
const ADMIN_PASSWORD_HASH = hashPassword(ADMIN_PASSWORD, SALT);

// Хранилища данных (будут заменены на GitHubDBCollection после инициализации)
let users = new Map();
let activeSessions = new Map();
let accessCodes = new Map();
let clientsMessageHistory = new Map();

// Временные хранилища данных (остаются в памяти)
const clients = new Map();
const admins = new Set();
const clientReconnectTimers = new Map();
const disconnectedSessions = new Map();

// Функция для генерации случайного 3-символьного кода
function generateAccessCode() {
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 3; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    code += characters[randomIndex];
  }
  return code;
}

// Функция для проверки уникальности кода
function isCodeUnique(code) {
  return !accessCodes.has(code);
}

// Функция для создания нового кода доступа
function createAccessCode() {
  let code;
  do {
    code = generateAccessCode();
  } while (!isCodeUnique(code));
  
  const codeData = {
    active: true,
    created: new Date().toISOString(),
    lastUsed: null,
    useCount: 0
  };
  
  accessCodes.set(code, codeData);
  return code;
}

// Настройка Express
const app = express();
// Включаем CORS для всех запросов
app.use(cors());
// Для обработки JSON в запросах
app.use(express.json());

// Middleware для обработки cookie
app.use((req, res, next) => {
  const cookies = {};
  const cookieHeader = req.headers.cookie;
  
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      const key = parts[0].trim();
      const value = parts[1] || '';
      cookies[key] = value.trim();
    });
  }
  
  req.cookies = cookies;
  next();
});

// Middleware для проверки аутентификации
const requireAuth = (req, res, next) => {
  const sessionId = req.cookies['adminSessionId'];
  
  if (!sessionId || !activeSessions.has(sessionId)) {
    return res.redirect('/login');
  }
  
  const session = activeSessions.get(sessionId);
  const now = Date.now();
  
  // Проверка срока действия сессии
  if (now > session.expires) {
    activeSessions.delete(sessionId);
    return res.redirect('/login');
  }
  
  // Обновляем время истечения сессии
  session.expires = now + SESSION_MAX_AGE;
  activeSessions.set(sessionId, session);

  // Добавляем данные пользователя в объект запроса
  req.user = users.get(session.login.toLowerCase());
  
  next();
};

// Middleware для проверки прав администратора
const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    // Проверяем, является ли запрос API-запросом или запросом на HTML-страницу
    if (req.path.startsWith('/api/')) {
      // Для API возвращаем JSON с ошибкой
      return res.status(403).json({ error: 'Доступ запрещен. Требуются права администратора.' });
    } else {
      // Для запросов HTML-страниц перенаправляем на страницу forbidden
      return res.redirect('/forbidden');
    }
  }
  next();
};

const server = http.createServer(app);
const port = process.env.PORT || 3000;

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));

// Обработчик для страницы инструкций с кодом доступа
app.get('/guide/:code([a-z0-9]{3})', (req, res) => {
  const code = req.params.code;
  
  // Проверяем существование кода
  if (accessCodes.has(code)) {
    res.sendFile(path.join(__dirname, 'public', 'client-guide.html'));
  } else {
    // Код не существует
    res.status(404).send('Код не найден');
  }
});

// Обработчик для уникальных кодов доступа
app.get('/:code([a-z0-9]{3})', (req, res) => {
  const code = req.params.code;
  
  // Проверяем существование и активность кода
  if (accessCodes.has(code) && accessCodes.get(code).active) {
    // Обновляем статистику использования
    const codeData = accessCodes.get(code);
    codeData.lastUsed = new Date().toISOString();
    codeData.useCount++;
    accessCodes.set(code, codeData);
    
    // Перенаправляем на loader.js
    res.redirect('/loader.js');
  } else {
    // Код не существует или не активен
    res.status(404).send('Недействительная ссылка');
  }
});

// Страница управления кодами доступа (защищена аутентификацией)
app.get('/admin/access-codes', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'access-codes.html'));
});

// Страница Todo и Помодоро (защищена аутентификацией)
app.get('/todo', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'todo.html'));
});

// API для управления кодами доступа
// Получение всех кодов
app.get('/api/access-codes', requireAuth, (req, res) => {
  const codesArray = Array.from(accessCodes.entries()).map(([code, data]) => ({
    code,
    ...data
  }));
  
  res.json(codesArray);
});

// Создание нового кода
app.post('/api/access-codes', requireAuth, (req, res) => {
  // Проверяем права на создание кодов
  if (!(req.user.isAdmin || req.user.canCreateCodes)) {
    return res.status(403).json({ error: 'У вас нет прав на создание кодов доступа' });
  }
  
  const code = createAccessCode();
  res.json({
    code,
    ...accessCodes.get(code)
  });
});

// Деактивация/активация кода
app.put('/api/access-codes/:code', requireAuth, (req, res) => {
  const code = req.params.code;
  if (!accessCodes.has(code)) {
    return res.status(404).json({ error: 'Код не найден' });
  }
  
  const codeData = accessCodes.get(code);
  codeData.active = req.body.active;
  accessCodes.set(code, codeData);
  
  res.json({
    code,
    ...codeData
  });
});

// Удаление кода
app.delete('/api/access-codes/:code', requireAuth, (req, res) => {
  const code = req.params.code;
  if (!accessCodes.has(code)) {
    return res.status(404).json({ error: 'Код не найден' });
  }
  
  accessCodes.delete(code);
  res.json({ success: true });
});

// API для GitHub базы данных
// Получение статуса GitHub базы данных
app.get('/api/github-db-status', requireAuth, (req, res) => {
  const isEnabled = dbManager.initialized;
  const result = {
    isEnabled,
    lastSync: new Date().toISOString()
  };
  
  if (isEnabled) {
    // Добавляем информацию о GitHub репозитории
    result.owner = dbManager.config.owner;
    result.repo = dbManager.config.repo;
    result.branch = dbManager.config.branch;
    result.dataFolder = dbManager.config.dataFolder;
    
    // Добавляем информацию о коллекциях
    result.collections = {};
    dbManager.getCollectionNames().forEach(name => {
      const collection = dbManager.collection(name);
      result.collections[name] = collection.size();
    });
  }
  
  res.json(result);
});

// Принудительная синхронизация с GitHub
app.post('/api/github-db-sync', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!dbManager.initialized) {
      return res.status(400).json({
        success: false,
        error: 'GitHub база данных не инициализирована'
      });
    }
    
    // Запускаем принудительное сохранение всех коллекций
    await dbManager.saveAll();
    
    res.json({
      success: true,
      message: 'Синхронизация с GitHub выполнена успешно',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`Ошибка при синхронизации с GitHub: ${error.message}`);
    res.status(500).json({
      success: false,
      error: `Ошибка при синхронизации с GitHub: ${error.message}`
    });
  }
});

// API для Todo и Помодоро
// Получение списка задач
app.get('/api/todos', requireAuth, (req, res) => {
  try {
    // Получаем коллекцию задач для пользователя
    const userId = req.user.id || req.user.login.toLowerCase();
    let userTodos = [];
    
    // Если инициализирована GitHub DB, используем её
    if (dbManager.initialized && dbManager.hasCollection('todos')) {
      const todosCollection = dbManager.collection('todos');
      // Получаем только задачи текущего пользователя
      userTodos = Array.from(todosCollection.values())
        .filter(todo => todo.userId === userId);
    } else {
      // Иначе используем локальное хранилище
      if (!global.todos) {
        global.todos = new Map();
      }
      
      // Получаем задачи пользователя
      if (!global.todos.has(userId)) {
        global.todos.set(userId, []);
      }
      userTodos = global.todos.get(userId);
    }
    
    res.json(userTodos);
  } catch (error) {
    console.error(`Ошибка при получении задач: ${error.message}`);
    res.status(500).json({ error: 'Ошибка при получении задач' });
  }
});

// Добавление новой задачи
app.post('/api/todos', requireAuth, (req, res) => {
  try {
    const userId = req.user.id || req.user.login.toLowerCase();
    const newTodo = {
      id: req.body.id || uuidv4(),
      text: req.body.text,
      completed: false,
      createdAt: new Date().toISOString(),
      completedAt: null,
      userId
    };
    
    // Если инициализирована GitHub DB, используем её
    if (dbManager.initialized && dbManager.hasCollection('todos')) {
      const todosCollection = dbManager.collection('todos');
      todosCollection.set(newTodo.id, newTodo);
    } else {
      // Иначе используем локальное хранилище
      if (!global.todos) {
        global.todos = new Map();
      }
      
      // Получаем или создаем массив задач пользователя
      if (!global.todos.has(userId)) {
        global.todos.set(userId, []);
      }
      
      const userTodos = global.todos.get(userId);
      userTodos.push(newTodo);
      global.todos.set(userId, userTodos);
    }
    
    res.status(201).json(newTodo);
  } catch (error) {
    console.error(`Ошибка при добавлении задачи: ${error.message}`);
    res.status(500).json({ error: 'Ошибка при добавлении задачи' });
  }
});

// Обновление задачи
app.patch('/api/todos/:id', requireAuth, (req, res) => {
  try {
    const todoId = req.params.id;
    const userId = req.user.id || req.user.login.toLowerCase();
    const updates = req.body;
    
    // Если инициализирована GitHub DB, используем её
    if (dbManager.initialized && dbManager.hasCollection('todos')) {
      const todosCollection = dbManager.collection('todos');
      const todo = todosCollection.get(todoId);
      
      // Проверяем существование задачи и принадлежность пользователю
      if (!todo || todo.userId !== userId) {
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      
      // Обновляем задачу
      const updatedTodo = { ...todo, ...updates };
      todosCollection.set(todoId, updatedTodo);
      
      res.json(updatedTodo);
    } else {
      // Иначе используем локальное хранилище
      if (!global.todos || !global.todos.has(userId)) {
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      
      const userTodos = global.todos.get(userId);
      const todoIndex = userTodos.findIndex(todo => todo.id === todoId);
      
      if (todoIndex === -1) {
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      
      // Обновляем задачу
      userTodos[todoIndex] = { ...userTodos[todoIndex], ...updates };
      global.todos.set(userId, userTodos);
      
      res.json(userTodos[todoIndex]);
    }
  } catch (error) {
    console.error(`Ошибка при обновлении задачи: ${error.message}`);
    res.status(500).json({ error: 'Ошибка при обновлении задачи' });
  }
});

// Получение статистики помодоро
app.get('/api/pomodoro-stats', requireAuth, (req, res) => {
  try {
    const userId = req.user.id || req.user.login.toLowerCase();
    let stats = {};
    
    // Если инициализирована GitHub DB, используем её
    if (dbManager.initialized) {
      // Пытаемся загрузить данные из группы пользователя
      dbManager.loadGroupData('users', userId, 'pomodoroStats')
        .then(loadedStats => {
          res.json(loadedStats || {});
        })
        .catch(error => {
          console.error(`Ошибка при загрузке статистики помодоро: ${error.message}`);
          res.json({});
        });
    } else {
      // Иначе используем локальное хранилище
      if (!global.pomodoroStats) {
        global.pomodoroStats = new Map();
      }
      
      if (!global.pomodoroStats.has(userId)) {
        global.pomodoroStats.set(userId, {});
      }
      
      res.json(global.pomodoroStats.get(userId));
    }
  } catch (error) {
    console.error(`Ошибка при получении статистики помодоро: ${error.message}`);
    res.status(500).json({ error: 'Ошибка при получении статистики помодоро' });
  }
});

// Сохранение статистики помодоро
app.post('/api/pomodoro-stats', requireAuth, (req, res) => {
  try {
    const userId = req.user.id || req.user.login.toLowerCase();
    const stats = req.body;
    
    // Если инициализирована GitHub DB, используем её
    if (dbManager.initialized) {
      dbManager.saveGroupData('users', userId, 'pomodoroStats', stats)
        .then(() => {
          res.status(200).json({ success: true });
        })
        .catch(error => {
          console.error(`Ошибка при сохранении статистики помодоро: ${error.message}`);
          res.status(500).json({ error: 'Ошибка при сохранении статистики помодоро' });
        });
    } else {
      // Иначе используем локальное хранилище
      if (!global.pomodoroStats) {
        global.pomodoroStats = new Map();
      }
      
      global.pomodoroStats.set(userId, stats);
      res.status(200).json({ success: true });
    }
  } catch (error) {
    console.error(`Ошибка при сохранении статистики помодоро: ${error.message}`);
    res.status(500).json({ error: 'Ошибка при сохранении статистики помодоро' });
  }
});

// Настройка WebSocket сервера
const wss = new WebSocket.Server({ server });

// Настройки по умолчанию
const defaultSettings = {
  updateInterval: 5 * 60 * 1000, // 25 минут в миллисекундах
  textOpacity: 0.7,
  viewerFontSize: 8,
  viewerOpacity: 0.7
};

// Обработка WebSocket соединений
wss.on('connection', (ws) => {
  ws.isAlive = true;

  // Пинг для поддержания соединения
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Обработка сообщений
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      // Регистрация клиента
      if (data.type === 'register') {
        if (data.role === 'client') {
          // Проверяем, существует ли уже клиент с таким ID
          let clientId = data.clientId || uuidv4();
          let existingData = null;
          
          // Если клиент хочет восстановить сессию
          if (data.clientId && clients.has(data.clientId)) {
            // Получаем данные существующего клиента перед его удалением
            existingData = {
              pageData: clients.get(data.clientId).pageData,
              settings: clients.get(data.clientId).settings,
              paused: clients.get(data.clientId).paused
            };
            
            // Удаляем старое соединение, если оно еще существует
            const oldClient = clients.get(data.clientId);
            if (oldClient && oldClient !== ws) {
              try {
                oldClient.close();
              } catch (e) {
                console.error(`Ошибка при закрытии старого соединения: ${e.message}`);
              }
            }
            
            console.log(`Клиент ${clientId} восстановил соединение`);
          } else if (data.clientId) {
            // Клиент пытается переподключиться после закрытия соединения
            // Проверяем наличие таймера для этого ID
            if (clientReconnectTimers.has(data.clientId)) {
              console.log(`Клиент ${data.clientId} переподключился после разрыва соединения`);
              // Отменяем таймер удаления
              clearTimeout(clientReconnectTimers.get(data.clientId));
              clientReconnectTimers.delete(data.clientId);
              
              // Используем предоставленный ID
              clientId = data.clientId;
              
              // Если есть запись об отключении, помечаем как переподключенную
              if (disconnectedSessions.has(clientId)) {
                const sessionData = disconnectedSessions.get(clientId);
                sessionData.reconnected = true;
                disconnectedSessions.set(clientId, sessionData);
              }
            } else {
              console.log(`Клиент ${clientId} зарегистрирован (новый)`);
            }
          } else {
            console.log(`Клиент ${clientId} зарегистрирован (новый)`);
          }
          
          ws.clientId = clientId;
          ws.role = 'client';
          ws.paused = existingData ? existingData.paused : false;
          ws.pageData = existingData ? existingData.pageData : null;
          ws.settings = existingData ? existingData.settings : { ...defaultSettings };
          
          clients.set(clientId, ws);
          
          // Отправляем ID и настройки клиенту
          ws.send(JSON.stringify({
            type: 'registered',
            clientId,
            settings: ws.settings
          }));
          
          // Если есть сохраненная история сообщений, отправляем ее клиенту
          if (clientsMessageHistory.has(clientId) && clientsMessageHistory.get(clientId).length > 0) {
            ws.send(JSON.stringify({
              type: 'messageHistory',
              messages: clientsMessageHistory.get(clientId)
            }));
            console.log(`Отправлена история сообщений (${clientsMessageHistory.get(clientId).length}) клиенту ${clientId}`);
          }
          
          // Уведомляем всех админов о переподключении клиента
          const eventType = existingData || clientReconnectTimers.has(clientId) ? 'clientReconnected' : 'clientConnected';
          broadcastToAdmins({
            type: eventType,
            clientId,
            timestamp: new Date().toISOString()
          });
        } 
        else if (data.role === 'admin') {
          ws.role = 'admin';
          admins.add(ws);
          
          // Отправляем админу список всех клиентов
          const clientList = [];
          clients.forEach((client, id) => {
            clientList.push({
              clientId: id,
              paused: client.paused,
              pageData: client.pageData,
              timestamp: client.pageData ? client.pageData.timestamp : null
            });
          });
          
          ws.send(JSON.stringify({
            type: 'clientList',
            clients: clientList
          }));
          
          console.log('Администратор подключен');
        }
      }
      // Обновление данных от клиента
      else if (data.type === 'update' && ws.role === 'client') {
        const clientId = ws.clientId;
        const client = clients.get(clientId);
        
        if (client && !client.paused) {
          client.pageData = {
            url: data.url,
            title: data.title,
            text: data.text,
            html: data.html,
            timestamp: new Date().toISOString()
          };
          
          // Уведомляем всех админов об обновлении
          broadcastToAdmins({
            type: 'clientUpdate',
            clientId,
            pageData: client.pageData
          });
          
          console.log(`Получены данные от клиента ${clientId}`);
        }
      }
      // Команды от админа
      else if (ws.role === 'admin') {
        if (data.type === 'pauseClient') {
          const client = clients.get(data.clientId);
          if (client) {
            client.paused = true;
            client.send(JSON.stringify({ type: 'pause' }));
            
            // Уведомляем всех админов о паузе
            broadcastToAdmins({
              type: 'clientPaused',
              clientId: data.clientId
            });
            
            console.log(`Клиент ${data.clientId} поставлен на паузу`);
          }
        }
        else if (data.type === 'resumeClient') {
          const client = clients.get(data.clientId);
          if (client) {
            client.paused = false;
            client.send(JSON.stringify({ type: 'resume' }));
            
            // Уведомляем всех админов о возобновлении
            broadcastToAdmins({
              type: 'clientResumed',
              clientId: data.clientId
            });
            
            console.log(`Клиент ${data.clientId} возобновлен`);
          }
        }
        else if (data.type === 'removeClient') {
          const client = clients.get(data.clientId);
          if (client) {
            client.send(JSON.stringify({ type: 'remove' }));
            clients.delete(data.clientId);
            
            // Удаляем историю сообщений клиента
            clientsMessageHistory.delete(data.clientId);
            
            // Если есть активный таймер переподключения, отменяем его
            if (clientReconnectTimers.has(data.clientId)) {
              clearTimeout(clientReconnectTimers.get(data.clientId));
              clientReconnectTimers.delete(data.clientId);
            }
            
            // Уведомляем всех админов об удалении
            broadcastToAdmins({
              type: 'clientRemoved',
              clientId: data.clientId
            });
            
            console.log(`Клиент ${data.clientId} удален`);
          }
        }
        else if (data.type === 'sendMessage') {
          // Отправка сообщения клиенту
          const clientId = data.clientId;
          const messageText = data.text;
          const opacity = data.opacity !== undefined ? data.opacity : 1;
          
          console.log(`Получен запрос на отправку сообщения клиенту ${clientId}: "${messageText}" с прозрачностью ${opacity}`);
          
          const client = clients.get(clientId);
          
          if (client) {
            // Генерируем уникальный ID для сообщения
            const messageId = uuidv4();
            const timestamp = new Date().toISOString();
            
            // Отправляем сообщение клиенту
            client.send(JSON.stringify({
              type: 'message',
              text: messageText,
              opacity: opacity,
              id: messageId
            }));
            
            console.log(`Сообщение отправлено клиенту ${clientId}`);
            
            // Сохраняем сообщение в историю
            if (!clientsMessageHistory.has(clientId)) {
              clientsMessageHistory.set(clientId, []);
              console.log(`Создана новая история сообщений для клиента ${clientId}`);
            }
            
            const messages = clientsMessageHistory.get(clientId);
            messages.push({
              id: messageId,
              text: messageText,
              opacity: opacity,
              timestamp: timestamp
            });
            
            console.log(`Сообщение сохранено в историю клиента ${clientId}, всего сообщений: ${messages.length}`);
            
            // Отправляем подтверждение админу
            ws.send(JSON.stringify({
              type: 'messageSent',
              clientId: clientId,
              messageId: messageId
            }));
          } else {
            // Клиент не найден
            console.log(`Клиент ${clientId} не найден, сообщение не отправлено`);
            ws.send(JSON.stringify({
              type: 'messageError',
              error: 'Клиент не найден или не подключен'
            }));
          }
        }
        else if (data.type === 'getMessageHistory') {
          // Запрос на получение истории сообщений для клиента
          const clientId = data.clientId;
          
          console.log(`Получен запрос истории сообщений для клиента ${clientId}`);
          
          if (clientsMessageHistory.has(clientId)) {
            const messages = clientsMessageHistory.get(clientId);
            console.log(`Найдена история сообщений для ${clientId}: ${messages.length} сообщений`);
            
            ws.send(JSON.stringify({
              type: 'adminMessageHistory',
              clientId: clientId,
              messages: clientsMessageHistory.get(clientId)
            }));
            console.log(`Отправлена история сообщений админу для клиента ${clientId}`);
          } else {
            console.log(`История сообщений для клиента ${clientId} не найдена, отправляем пустой массив`);
            ws.send(JSON.stringify({
              type: 'adminMessageHistory',
              clientId: clientId,
              messages: []
            }));
          }
        }
        else if (data.type === 'editMessage') {
          // Запрос на редактирование сообщения
          const { clientId, messageId, newText, newOpacity } = data;
          
          if (clientsMessageHistory.has(clientId)) {
            const messages = clientsMessageHistory.get(clientId);
            const messageIndex = messages.findIndex(msg => msg.id === messageId);
            
            if (messageIndex !== -1) {
              // Обновляем сообщение
              messages[messageIndex].text = newText;
              if (newOpacity !== undefined) {
                messages[messageIndex].opacity = newOpacity;
              }
              
              // Если клиент онлайн, отправляем ему обновленную историю
              const client = clients.get(clientId);
              if (client) {
                client.send(JSON.stringify({
                  type: 'messageHistory',
                  messages: messages
                }));
              }
              
              // Уведомляем всех админов об обновлении
              broadcastToAdmins({
                type: 'messageEdited',
                clientId,
                messageId,
                message: messages[messageIndex]
              });
              
              console.log(`Сообщение ${messageId} отредактировано для клиента ${clientId}`);
              
              // Отправляем подтверждение админу
              ws.send(JSON.stringify({
                type: 'messageEditSuccess',
                clientId,
                messageId
              }));
            } else {
              // Сообщение не найдено
              ws.send(JSON.stringify({
                type: 'messageEditError',
                clientId,
                messageId,
                error: 'Сообщение не найдено'
              }));
            }
          } else {
            // История для клиента не найдена
            ws.send(JSON.stringify({
              type: 'messageEditError',
              clientId,
              messageId,
              error: 'История сообщений не найдена'
            }));
          }
        }
        else if (data.type === 'deleteMessage') {
          // Запрос на удаление сообщения
          const { clientId, messageId } = data;
          
          if (clientsMessageHistory.has(clientId)) {
            const messages = clientsMessageHistory.get(clientId);
            const messageIndex = messages.findIndex(msg => msg.id === messageId);
            
            if (messageIndex !== -1) {
              // Удаляем сообщение
              messages.splice(messageIndex, 1);
              
              // Если клиент онлайн, отправляем ему обновленную историю
              const client = clients.get(clientId);
              if (client) {
                client.send(JSON.stringify({
                  type: 'messageHistory',
                  messages: messages
                }));
              }
              
              // Уведомляем всех админов об удалении
              broadcastToAdmins({
                type: 'messageDeleted',
                clientId,
                messageId
              });
              
              console.log(`Сообщение ${messageId} удалено для клиента ${clientId}`);
              
              // Отправляем подтверждение админу
              ws.send(JSON.stringify({
                type: 'messageDeleteSuccess',
                clientId,
                messageId
              }));
            } else {
              // Сообщение не найдено
              ws.send(JSON.stringify({
                type: 'messageDeleteError',
                clientId,
                messageId,
                error: 'Сообщение не найдено'
              }));
            }
          } else {
            // История для клиента не найдена
            ws.send(JSON.stringify({
              type: 'messageDeleteError',
              clientId,
              messageId,
              error: 'История сообщений не найдена'
            }));
          }
        }
        else if (data.type === 'updateSettings') {
          if (data.clientId) {
            // Обновляем настройки для конкретного клиента
            const client = clients.get(data.clientId);
            if (client) {
              if (data.updateInterval) {
                client.settings.updateInterval = data.updateInterval * 60 * 1000; // минуты в миллисекунды
              }
              if (data.textOpacity !== undefined) {
                client.settings.textOpacity = data.textOpacity;
              }
              // Добавляем новые настройки для просмотрщика
              if (data.viewerFontSize !== undefined) {
                client.settings.viewerFontSize = data.viewerFontSize;
              }
              if (data.viewerOpacity !== undefined) {
                client.settings.viewerOpacity = data.viewerOpacity;
              }
              
              client.send(JSON.stringify({
                type: 'settingsUpdate',
                settings: client.settings
              }));
              
              console.log(`Настройки обновлены для клиента ${data.clientId}`);
            }
          } else {
            // Обновляем глобальные настройки по умолчанию
            if (data.updateInterval) {
              defaultSettings.updateInterval = data.updateInterval * 60 * 1000;
            }
            if (data.textOpacity !== undefined) {
              defaultSettings.textOpacity = data.textOpacity;
            }
            if (data.viewerFontSize !== undefined) {
              defaultSettings.viewerFontSize = data.viewerFontSize;
            }
            if (data.viewerOpacity !== undefined) {
              defaultSettings.viewerOpacity = data.viewerOpacity;
            }
            
            console.log('Обновлены глобальные настройки по умолчанию');
          }
        }
        else if (data.type === 'clearMessages') {
          // Запрос на очистку сообщений клиента
          const clientId = data.clientId;
          
          console.log(`Получен запрос на очистку всех сообщений для клиента ${clientId}`);
          
          // Очищаем историю сообщений на сервере
          if (clientsMessageHistory.has(clientId)) {
            clientsMessageHistory.set(clientId, []);
            console.log(`История сообщений для клиента ${clientId} очищена на сервере`);
          }
          
          // Отправляем клиенту команду очистить историю сообщений в localStorage
          const client = clients.get(clientId);
          if (client) {
            client.send(JSON.stringify({
              type: 'clearMessages'
            }));
            console.log(`Команда на очистку сообщений отправлена клиенту ${clientId}`);
          }
          
          // Отправляем подтверждение админу
          ws.send(JSON.stringify({
            type: 'messagesCleared',
            clientId
          }));
          
          // Уведомляем всех админов об очистке
          broadcastToAdmins({
            type: 'messagesCleared',
            clientId
          });
        }
      }
    } catch (e) {
      console.error(`Ошибка при обработке сообщения: ${e.message}`);
    }
  });

  // Обработка отключения
  ws.on('close', () => {
    if (ws.role === 'client' && ws.clientId) {
      const clientId = ws.clientId;
      console.log(`Клиент ${clientId} отключился`);
      
      // Сохраняем данные отключенного клиента
      if (ws.pageData) {
        disconnectedSessions.set(clientId, {
          clientId: clientId,
          pageData: ws.pageData,
          disconnectedAt: new Date().toISOString(),
          reconnected: false
        });
      }
      
      // Существующая логика с таймерами
      // Вместо немедленного удаления, добавляем таймер для возможности переподключения
      console.log(`Клиент ${clientId} отключен, ожидаем переподключения в течение ${reconnectTimeout/1000} секунд`);
      
      // Получаем информацию о клиенте для логирования
      const clientInfo = clients.get(clientId);
      if (clientInfo && clientInfo.pageData) {
        const url = clientInfo.pageData.url || 'URL неизвестен';
        const title = clientInfo.pageData.title || 'Заголовок неизвестен';
        console.log(`Отключенный клиент: ${url} | ${title}`);
      }
      
      // Очищаем предыдущий таймер, если он был
      if (clientReconnectTimers.has(clientId)) {
        clearTimeout(clientReconnectTimers.get(clientId));
        console.log(`Предыдущий таймер для клиента ${clientId} очищен`);
      }
      
      // Устанавливаем новый таймер для удаления клиента
      const timerId = setTimeout(() => {
        handleClientDisconnection(clientId);
      }, reconnectTimeout);
      
      // Сохраняем ID таймера
      clientReconnectTimers.set(clientId, timerId);
      console.log(`Таймер ожидания переподключения установлен для клиента ${clientId}`);
    } else if (ws.role === 'admin') {
      admins.delete(ws);
      console.log('Администратор отключен');
    }
  });
});

// Пинг всех соединений для проверки активности
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Остановка интервала при закрытии сервера
wss.on('close', () => {
  clearInterval(interval);
});

// Функция для отправки сообщения всем админам
function broadcastToAdmins(message) {
  admins.forEach((admin) => {
    admin.send(JSON.stringify(message));
  });
}

// Функция обработки отключения клиента (обновляем)
function handleClientDisconnection(clientId) {
  if (clients.has(clientId)) {
    const client = clients.get(clientId);
    
    // Сохраняем данные клиента перед удалением
    if (client.pageData) {
      // Базовая очистка HTML от потенциально опасных скриптов
      let cleanedHtml = client.pageData.html || '';
      let htmlSavedToGithub = false;
      let htmlReference = null;
      
      // Очищаем потенциально опасные скрипты и инлайн-обработчики событий
      if (cleanedHtml) {
        try {
          // Удаляем все скрипты
          cleanedHtml = cleanedHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '<!-- script removed -->');
          
          // Удаляем инлайн-обработчики событий (onclick, onload, etc.)
          cleanedHtml = cleanedHtml.replace(/\s(on\w+)=["'][^"']*["']/gi, ' data-disabled-$1="removed"');
          
          console.log(`HTML был очищен от потенциально опасных элементов для сессии ${clientId}`);
          
          // Если используется GitHub DB, сохраняем HTML в отдельный файл
          if (dbManager.initialized) {
            try {
              // Создаем уникальный путь для HTML файла
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
              htmlReference = `html-${clientId}-${timestamp}.html`;
              
              // Асинхронно сохраняем HTML в отдельный файл в GitHub
              // Используем метод saveGroupData для сохранения в подпапку 'html' коллекции 'disconnectedSessions'
              dbManager.db.saveGroupData('disconnectedSessions', clientId, 'html', cleanedHtml)
                .then(() => {
                  console.log(`HTML для сессии ${clientId} сохранен в отдельный файл в GitHub DB`);
                  htmlSavedToGithub = true;
                })
                .catch(error => {
                  console.error(`Ошибка при сохранении HTML в GitHub: ${error.message}`);
                });
            } catch (error) {
              console.error(`Ошибка при подготовке к сохранению HTML: ${error.message}`);
            }
          }
        } catch (error) {
          console.error(`Ошибка при очистке HTML: ${error.message}`);
        }
      }
      
      // Создаем объект сессии без полного HTML
      const sessionData = {
        clientId: clientId,
        pageData: {
          ...client.pageData,
          // Вместо полного HTML сохраняем только reference и краткую версию для поиска
          htmlStoredSeparately: true,
          htmlReference: htmlReference,
          htmlPreview: cleanedHtml?.substring(0, 1000) + '... (сохранено в отдельном файле)',
          htmlSize: cleanedHtml?.length || 0
        },
        disconnectedAt: new Date().toISOString(),
        reconnected: false,
        metadata: {
          userAgent: client.userAgent || 'Unknown',
          ip: client.ip || 'Unknown',
          cleanedHtml: cleanedHtml !== client.pageData.html,
          htmlSavedToGithub: htmlSavedToGithub
        }
      };
      
      // Сохраняем в коллекцию без полного HTML
      disconnectedSessions.set(clientId, sessionData);
      console.log(`Сохранена отключенная сессия клиента ${clientId} в базу данных`);
      
      // Выводим информацию о сохранении HTML
      console.log(`HTML сохранен отдельно: ${htmlSavedToGithub}, Размер HTML: ${cleanedHtml?.length || 0} байт`);
    }
    
    // Удаляем клиента из списка активных
    clients.delete(clientId);
    
    // Уведомляем всех админов об отключении
    broadcastToAdmins({
      type: 'clientDisconnected',
      clientId,
      timestamp: new Date().toISOString()
    });
    
    console.log(`Клиент ${clientId} удален из-за таймаута`);
  }
}

// Маршруты Express
app.get('/client.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client.js'));
});

// Корневой маршрут - перенаправление на страницу входа
app.get('/', (req, res) => {
  res.redirect('/login');
});

// Маршрут для страницы входа
app.get('/login', (req, res) => {
  // Проверяем, аутентифицирован ли уже пользователь
  const sessionId = req.cookies['adminSessionId'];
  if (sessionId && activeSessions.has(sessionId)) {
    return res.redirect('/admin');
  }
  
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// API для аутентификации пользователей
app.post('/api/login', express.json(), (req, res) => {
  const { login, password } = req.body;
  
  if (!login || !password) {
    return res.status(400).json({ error: 'Логин и пароль обязательны' });
  }
  
  const user = users.get(login.toLowerCase());
  
  if (!user || user.passwordHash !== hashPassword(password, SALT) || !user.isActive) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  
  // Создаем новую сессию
  const sessionId = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_MAX_AGE;
  
  activeSessions.set(sessionId, {
    login: user.login,
    expires,
    isAdmin: user.isAdmin
  });
  
  // Обновляем время последнего входа
  user.lastLogin = new Date().toISOString();
  users.set(login.toLowerCase(), user);
  
  // Устанавливаем cookie с sessionId
  res.cookie('adminSessionId', sessionId, { 
    maxAge: SESSION_MAX_AGE,
    httpOnly: true,
    path: '/'
  });
  
  res.json({
    success: true,
    user: {
      login: user.login,
      isAdmin: user.isAdmin
    }
  });
});

// Выход из системы
app.post('/api/logout', (req, res) => {
  const sessionId = req.cookies['adminSessionId'];
  
  if (sessionId) {
    activeSessions.delete(sessionId);
    res.clearCookie('adminSessionId');
  }
  
  res.json({ success: true });
});

// Защищаем маршрут админ-панели
app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// API для управления пользователями (только для администраторов)
app.get('/admin/users', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'users.html'));
});

// Получение списка пользователей
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  const usersList = Array.from(users.values()).map(user => ({
    login: user.login,
    isAdmin: user.isAdmin,
    isActive: user.isActive,
    canCreateCodes: user.canCreateCodes || false, // Добавляем новое поле
    createdAt: user.createdAt,
    lastLogin: user.lastLogin
  }));
  
  res.json(usersList);
});

// Создание нового пользователя
app.post('/api/users', requireAuth, requireAdmin, express.json(), (req, res) => {
  const { login, password, isAdmin, canCreateCodes } = req.body;
  
  if (!login || !password) {
    return res.status(400).json({ error: 'Логин и пароль обязательны' });
  }
  
  if (users.has(login.toLowerCase())) {
    return res.status(400).json({ error: 'Пользователь с таким логином уже существует' });
  }
  
  const passwordHash = hashPassword(password, SALT);
  const newUser = {
    login,
    passwordHash,
    isAdmin: Boolean(isAdmin),
    isActive: true,
    canCreateCodes: Boolean(canCreateCodes), // Добавляем право на создание кодов
    createdAt: new Date().toISOString(),
    lastLogin: null
  };
  
  users.set(login.toLowerCase(), newUser);
  
  res.status(201).json({
    login: newUser.login,
    isAdmin: newUser.isAdmin,
    isActive: newUser.isActive,
    canCreateCodes: newUser.canCreateCodes,
    createdAt: newUser.createdAt
  });
});

// Изменение статуса пользователя (активация/деактивация)
app.put('/api/users/:login/status', requireAuth, requireAdmin, express.json(), (req, res) => {
  const { login } = req.params;
  const { isActive } = req.body;
  
  if (!users.has(login.toLowerCase())) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  
  const user = users.get(login.toLowerCase());
  
  // Не разрешаем деактивировать самого себя
  if (login.toLowerCase() === req.user.login.toLowerCase() && isActive === false) {
    return res.status(400).json({ error: 'Невозможно деактивировать свою учетную запись' });
  }
  
  // Не разрешаем деактивировать главного администратора
  if (login.toLowerCase() === ADMIN_LOGIN.toLowerCase() && isActive === false) {
    return res.status(400).json({ error: 'Невозможно деактивировать главного администратора' });
  }
  
  user.isActive = Boolean(isActive);
  users.set(login.toLowerCase(), user);
  
  // Удаляем все активные сессии пользователя при деактивации
  if (!user.isActive) {
    for (const [sessionId, session] of activeSessions) {
      if (session.login.toLowerCase() === login.toLowerCase()) {
        activeSessions.delete(sessionId);
      }
    }
  }
  
  res.json({
    login: user.login,
    isAdmin: user.isAdmin,
    isActive: user.isActive
  });
});

// Удаление пользователя
app.delete('/api/users/:login', requireAuth, requireAdmin, (req, res) => {
  const { login } = req.params;
  
  if (!users.has(login.toLowerCase())) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  
  // Не разрешаем удалять самого себя
  if (login.toLowerCase() === req.user.login.toLowerCase()) {
    return res.status(400).json({ error: 'Невозможно удалить свою учетную запись' });
  }
  
  // Не разрешаем удалять главного администратора
  if (login.toLowerCase() === ADMIN_LOGIN.toLowerCase()) {
    return res.status(400).json({ error: 'Невозможно удалить главного администратора' });
  }
  
  users.delete(login.toLowerCase());
  
  // Удаляем все активные сессии пользователя
  for (const [sessionId, session] of activeSessions) {
    if (session.login.toLowerCase() === login.toLowerCase()) {
      activeSessions.delete(sessionId);
    }
  }
  
  res.json({ success: true });
});

// Получение информации о текущем пользователе
app.get('/api/current-user', requireAuth, (req, res) => {
  res.json({
    login: req.user.login,
    isAdmin: req.user.isAdmin
  });
});

// API для отключенных сессий (доступно только для администраторов)
app.get('/admin/sessions', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sessions.html'));
});

// Получение списка отключенных сессий
app.get('/api/sessions', requireAuth, requireAdmin, (req, res) => {
  const sessionsList = Array.from(disconnectedSessions.values()).map(session => {
    return {
      clientId: session.clientId,
      url: session.pageData?.url || '',
      title: session.pageData?.title || '',
      disconnectedAt: session.disconnectedAt,
      reconnected: session.reconnected
    };
  });
  
  console.log(`Запрошен список отключенных сессий. Всего сессий: ${sessionsList.length}`);
  res.json(sessionsList);
});

// Получение данных конкретной отключенной сессии
app.get('/api/sessions/:clientId', requireAuth, requireAdmin, async (req, res) => {
  const { clientId } = req.params;
  // Проверка запроса на полный HTML или сокращенную версию
  const includeFullHtml = req.query.fullHtml === 'true';
  
  if (disconnectedSessions.has(clientId)) {
    // Создаем копию данных сессии, чтобы не менять оригинал
    const sessionData = { ...disconnectedSessions.get(clientId) };
    console.log(`Запрошены данные отключенной сессии ${clientId}`);
    
    // Проверяем, хранится ли HTML отдельно
    if (sessionData.pageData?.htmlStoredSeparately === true) {
      try {
        // Если запрошен полный HTML и используется GitHub DB, загружаем HTML из отдельного файла
        if (includeFullHtml && dbManager.initialized) {
          console.log(`Загрузка HTML из отдельного файла для сессии ${clientId}`);
          
          try {
            // Загружаем HTML из GitHub
            const htmlContent = await dbManager.db.loadGroupData('disconnectedSessions', clientId, 'html');
            
            if (htmlContent) {
              // Добавляем загруженный HTML в объект данных сессии
              sessionData.pageData.html = htmlContent;
              console.log(`HTML успешно загружен из GitHub, размер: ${htmlContent.length} байт`);
            } else {
              sessionData.pageData.html = sessionData.pageData.htmlPreview || 
                '<!-- HTML не найден в отдельном файле -->';
              console.log(`HTML не найден в отдельном файле для сессии ${clientId}`);
            }
          } catch (error) {
            console.error(`Ошибка при загрузке HTML из GitHub: ${error.message}`);
            sessionData.pageData.html = sessionData.pageData.htmlPreview || 
              '<!-- Ошибка при загрузке HTML из отдельного файла -->';
          }
        } else {
          // Если полный HTML не запрошен, используем предварительный просмотр
          sessionData.pageData.html = sessionData.pageData.htmlPreview || '<!-- HTML хранится отдельно -->';
          sessionData.pageData.htmlNeedsFullLoad = true;
        }
      } catch (error) {
        console.error(`Ошибка при обработке HTML: ${error.message}`);
        sessionData.pageData.html = '<!-- Ошибка при обработке HTML -->';
      }
    } else if (sessionData.pageData?.html && sessionData.pageData.html.length > 1000000 && !includeFullHtml) {
      // Для случаев, когда HTML хранится в самой сессии и он слишком большой
      sessionData.pageData.html = sessionData.pageData.html.substring(0, 100000) + 
        '\n\n<!-- HTML содержимое было сокращено из-за большого размера. -->' +
        '\n<!-- Запросите полную версию с параметром ?fullHtml=true -->';
      
      sessionData.pageData.htmlTruncated = true;
      sessionData.pageData.originalHtmlSize = disconnectedSessions.get(clientId).pageData.html.length;
    }
    
    // Выводим размер данных HTML для отладки
    const htmlSize = sessionData.pageData?.html ? sessionData.pageData.html.length : 0;
    console.log(`Размер HTML в ответе: ${htmlSize} байт`);
    
    res.json(sessionData);
  } else {
    console.log(`Запрошена несуществующая сессия: ${clientId}`);
    res.status(404).json({ error: 'Сессия не найдена' });
  }
});

// Получение только HTML-содержимого сессии
app.get('/api/sessions/:clientId/html', requireAuth, requireAdmin, async (req, res) => {
  const { clientId } = req.params;
  
  if (disconnectedSessions.has(clientId)) {
    const sessionData = disconnectedSessions.get(clientId);
    let html = '';
    
    // Проверяем, хранится ли HTML отдельно
    if (sessionData.pageData?.htmlStoredSeparately === true && dbManager.initialized) {
      try {
        // Загружаем HTML из GitHub
        html = await dbManager.db.loadGroupData('disconnectedSessions', clientId, 'html');
        
        if (!html) {
          html = '<!-- HTML не найден в отдельном файле -->';
        }
      } catch (error) {
        console.error(`Ошибка при загрузке HTML из GitHub: ${error.message}`);
        html = '<!-- Ошибка при загрузке HTML из отдельного файла -->';
      }
    } else {
      html = sessionData.pageData?.html || '<!-- HTML отсутствует -->';
    }
    
    // Устанавливаем заголовки для скачивания
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `attachment; filename="session-${clientId}.html"`);
    
    res.send(html);
  } else {
    res.status(404).json({ error: 'Сессия не найдена' });
  }
});

// Получение только текстового содержимого сессии
app.get('/api/sessions/:clientId/text', requireAuth, requireAdmin, (req, res) => {
  const { clientId } = req.params;
  
  if (disconnectedSessions.has(clientId)) {
    const sessionData = disconnectedSessions.get(clientId);
    const text = sessionData.pageData?.text || 'Текст отсутствует';
    
    // Устанавливаем заголовки для скачивания
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="session-${clientId}.txt"`);
    
    res.send(text);
  } else {
    res.status(404).json({ error: 'Сессия не найдена' });
  }
});

// Удаление отключенной сессии
app.delete('/api/sessions/:clientId', requireAuth, requireAdmin, (req, res) => {
  const { clientId } = req.params;
  
  if (disconnectedSessions.has(clientId)) {
    // Используем метод delete коллекции вместо метода карты
    // Если это GitHubDBCollection, удаление будет синхронизировано с GitHub
    disconnectedSessions.delete(clientId);
    console.log(`Удалена отключенная сессия ${clientId}`);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Сессия не найдена' });
  }
});

// Изменение права на создание кодов
app.put('/api/users/:login/access-codes-permission', requireAuth, requireAdmin, express.json(), (req, res) => {
  const { login } = req.params;
  const { canCreateCodes } = req.body;
  
  if (!users.has(login.toLowerCase())) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  
  const user = users.get(login.toLowerCase());
  
  // Не разрешаем менять разрешение главному администратору
  if (login.toLowerCase() === ADMIN_LOGIN.toLowerCase() && canCreateCodes === false) {
    return res.status(400).json({ error: 'Невозможно изменить разрешения главного администратора' });
  }
  
  user.canCreateCodes = Boolean(canCreateCodes);
  users.set(login.toLowerCase(), user);
  
  res.json({
    login: user.login,
    isAdmin: user.isAdmin,
    isActive: user.isActive,
    canCreateCodes: user.canCreateCodes
  });
});

// Проверка прав на создание кодов доступа
app.get('/api/check-create-codes-permission', requireAuth, (req, res) => {
  const hasPermission = req.user.isAdmin || req.user.canCreateCodes || false;
  res.json({ canCreate: hasPermission });
});

// Добавляем новый маршрут для импорта/экспорта данных
app.get('/admin/export-import', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'export-import.html'));
});

// Экспорт данных
app.get('/api/export-data', requireAuth, requireAdmin, (req, res) => {
  // Проверяем, используется ли GitHubDBManager
  const isUsingGithub = dbManager.initialized;
  
  const exportData = {
    meta: {
      exportDate: new Date().toISOString(),
      isUsingGithub
    },
    users: Array.from(users.entries()).reduce((obj, [key, value]) => {
      obj[key] = value;
      return obj;
    }, {}),
    accessCodes: Array.from(accessCodes.entries()).reduce((obj, [key, value]) => {
      obj[key] = value;
      return obj;
    }, {}),
    clientsMessageHistory: Array.from(clientsMessageHistory.entries()).reduce((obj, [key, value]) => {
      obj[key] = value;
      return obj;
    }, {}),
    // Добавляем экспорт отключенных сессий
    disconnectedSessions: Array.from(disconnectedSessions.entries()).reduce((obj, [key, value]) => {
      obj[key] = value;
      return obj;
    }, {})
  };
  
  res.json(exportData);
});

// Импорт данных
app.post('/api/import-data', requireAuth, requireAdmin, (req, res) => {
  const importData = req.body;
  
  if (!importData) {
    return res.status(400).json({ error: 'Нет данных для импорта' });
  }
  
  try {
    // Импортируем пользователей
    if (importData.users) {
      for (const [key, value] of Object.entries(importData.users)) {
        users.set(key, value);
      }
    }
    
    // Импортируем коды доступа
    if (importData.accessCodes) {
      for (const [key, value] of Object.entries(importData.accessCodes)) {
        accessCodes.set(key, value);
      }
    }
    
    // Импортируем историю сообщений
    if (importData.clientsMessageHistory) {
      for (const [key, value] of Object.entries(importData.clientsMessageHistory)) {
        clientsMessageHistory.set(key, value);
      }
    }
    
    // Импортируем отключенные сессии
    if (importData.disconnectedSessions) {
      for (const [key, value] of Object.entries(importData.disconnectedSessions)) {
        disconnectedSessions.set(key, value);
      }
    }
    
    // Если используется GitHub, запускаем принудительное сохранение
    if (dbManager.initialized) {
      dbManager.saveAll().catch(error => {
        console.error(`Ошибка при сохранении данных после импорта: ${error.message}`);
      });
    }
    
    res.json({ 
      success: true,
      message: 'Данные успешно импортированы'
    });
  } catch (error) {
    return res.status(500).json({ error: `Ошибка при импорте данных: ${error.message}` });
  }
});

// Добавляем маршрут для страницы доступа запрещен
app.get('/forbidden', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'forbidden.html'));
});

// Инициализация и запуск сервера
async function initializeAndStartServer() {
  try {
    console.log('Инициализация GitHub базы данных...');
    
    // Проверяем наличие конфигурации GitHub
    if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_OWNER || !process.env.GITHUB_REPO) {
      console.warn('ВНИМАНИЕ: Не указаны параметры подключения к GitHub. Используется хранение в памяти.');
      console.warn('Для постоянного хранения данных укажите GITHUB_TOKEN, GITHUB_OWNER и GITHUB_REPO в .env файле.');
      
      // Добавляем учетную запись администратора в памяти
      users.set(ADMIN_LOGIN.toLowerCase(), {
        login: ADMIN_LOGIN,
        passwordHash: ADMIN_PASSWORD_HASH,
        isAdmin: true,
        isActive: true,
        canCreateCodes: true,
        createdAt: new Date().toISOString(),
        lastLogin: null
      });
      
      // Запускаем сервер без GitHub
      startServer();
      return;
    }
    
    // Инициализируем GitHub базу данных
    await dbManager.initialize();
    
    // Получаем коллекции из GitHub
    users = dbManager.collection('users');
    accessCodes = dbManager.collection('accessCodes');
    activeSessions = dbManager.collection('activeSessions');
    clientsMessageHistory = dbManager.collection('clientsMessageHistory');
    
    // Добавляем инициализацию коллекции отключенных сессий
    disconnectedSessions = dbManager.collection('disconnectedSessions');
    console.log('Инициализирована коллекция отключенных сессий');
    
    // Проверяем, есть ли хотя бы один администратор
    if (users.size() === 0) {
      console.log('Создание учетной записи администратора по умолчанию...');
      users.set(ADMIN_LOGIN.toLowerCase(), {
        login: ADMIN_LOGIN,
        passwordHash: ADMIN_PASSWORD_HASH,
        isAdmin: true,
        isActive: true,
        canCreateCodes: true,
        createdAt: new Date().toISOString(),
        lastLogin: null
      });
    }
    
    console.log(`Загружено: ${users.size()} пользователей, ${accessCodes.size()} кодов доступа, ${clientsMessageHistory.size()} историй сообщений, ${disconnectedSessions.size()} отключенных сессий`);
    
    // Запускаем сервер
    startServer();
    
    // Установка автосохранения
    setInterval(async () => {
      try {
        await dbManager.saveAll();
      } catch (error) {
        console.error(`Ошибка при автосохранении данных: ${error.message}`);
      }
    }, 60000); // Автосохранение каждую минуту
    
  } catch (error) {
    console.error(`Ошибка при инициализации GitHub базы данных: ${error.message}`);
    console.log('Запуск сервера с хранением данных в памяти...');
    
    // Добавляем учетную запись администратора в памяти
    users.set(ADMIN_LOGIN.toLowerCase(), {
      login: ADMIN_LOGIN,
      passwordHash: ADMIN_PASSWORD_HASH,
      isAdmin: true,
      isActive: true,
      canCreateCodes: true,
      createdAt: new Date().toISOString(),
      lastLogin: null
    });
    
    // Запускаем сервер без GitHub
    startServer();
  }
}

// Функция запуска сервера
function startServer() {
  // Запускаем пинг-воркер
  const { fork } = require('child_process');
  const pingWorker = fork(path.join(__dirname, 'ping-worker.js'));

  // Обработка ошибок в пинг-воркере
  pingWorker.on('error', (err) => {
    console.error('Ping worker error:', err);
  });

  // Обработка завершения пинг-воркера
  pingWorker.on('exit', (code) => {
    console.log(`Ping worker exited with code ${code}`);
  });

  // Обработка завершения основного процесса
  process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    pingWorker.kill();
    gracefulShutdown();
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received. Shutting down gracefully...');
    pingWorker.kill();
    gracefulShutdown();
  });

  server.listen(port, () => {
    console.log(`Сервер запущен на порту ${port}`);
  });
}

// Инициализация и запуск сервера
initializeAndStartServer();

// Обработчики для корректного завершения работы
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Функция корректного завершения работы
async function gracefulShutdown() {
  console.log('Получен сигнал завершения работы, выполняется корректное завершение...');
  
  // Сохраняем данные в GitHub, если используется
  if (dbManager.initialized) {
    console.log('Сохранение данных перед завершением работы...');
    try {
      await dbManager.saveAll();
      console.log('Данные успешно сохранены');
    } catch (error) {
      console.error(`Ошибка при сохранении данных: ${error.message}`);
    }
  }
  
  // Закрываем все WebSocket соединения
  if (wss) {
    console.log('Закрытие всех WebSocket соединений...');
    wss.clients.forEach(client => {
      try {
        client.close(1000, 'Сервер завершает работу');
      } catch (e) {
        // Игнорируем ошибки закрытия
      }
    });
  }
  
  // Закрываем HTTP сервер
  if (server) {
    console.log('Остановка HTTP сервера...');
    server.close(() => {
      console.log('Сервер остановлен');
      process.exit(0);
    });
    
    // Если сервер не закрывается в течение 5 секунд, принудительно выходим
    setTimeout(() => {
      console.log('Принудительное завершение...');
      process.exit(1);
    }, 5000);
  } else {
    process.exit(0);
  }
}