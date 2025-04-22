const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');

// Функция для хеширования пароля с использованием SHA-256
function hashPassword(password, salt) {
  return crypto.createHmac('sha256', salt)
    .update(password)
    .digest('hex');
}

// Константы для аутентификации
const ADMIN_PASSWORD = 'Z6489092Akumi!s@'; // Установленный пароль
const SALT = 'f8a3j2k4l9z7m5n6'; // Соль для хеширования (в реальном проекте должна быть защищена)
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 часа

// Хеширование пароля администратора
const ADMIN_PASSWORD_HASH = hashPassword(ADMIN_PASSWORD, SALT);

// Хранилище для активных сессий
const activeSessions = new Map();

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
  
  next();
};

const server = http.createServer(app);
const port = process.env.PORT || 3000;

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));

// Настройка WebSocket сервера
const wss = new WebSocket.Server({ server });

// Хранилище клиентов и админов
const clients = new Map();
const admins = new Set();

// История сообщений для каждого клиента на сервере
const clientsMessageHistory = new Map();

// Настройки по умолчанию
const defaultSettings = {
  updateInterval: 5 * 60 * 1000, // 25 минут в миллисекундах
  textOpacity: 0.7,
  viewerFontSize: 8,
  viewerOpacity: 0.7
};

// Хранилище таймеров для клиентов
const clientReconnectTimers = new Map();
const reconnectTimeout = 10000; // Увеличиваем до 60 секунд для переподключения

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
    if (ws.role === 'client') {
      if (ws.clientId) {
        // Вместо немедленного удаления, добавляем таймер для возможности переподключения
        console.log(`Клиент ${ws.clientId} отключен, ожидаем переподключения в течение ${reconnectTimeout/1000} секунд`);
        
        // Получаем информацию о клиенте для логирования
        const clientInfo = clients.get(ws.clientId);
        if (clientInfo && clientInfo.pageData) {
          const url = clientInfo.pageData.url || 'URL неизвестен';
          const title = clientInfo.pageData.title || 'Заголовок неизвестен';
          console.log(`Отключенный клиент: ${url} | ${title}`);
        }
        
        // Очищаем предыдущий таймер, если он был
        if (clientReconnectTimers.has(ws.clientId)) {
          clearTimeout(clientReconnectTimers.get(ws.clientId));
          console.log(`Предыдущий таймер для клиента ${ws.clientId} очищен`);
        }
        
        // Устанавливаем новый таймер для удаления клиента
        const timerId = setTimeout(() => {
          handleClientDisconnection(ws.clientId);
        }, reconnectTimeout);
        
        // Сохраняем ID таймера
        clientReconnectTimers.set(ws.clientId, timerId);
        console.log(`Таймер ожидания переподключения установлен для клиента ${ws.clientId}`);
      }
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

// Функция для очистки данных об отключенном клиенте
function handleClientDisconnection(clientId) {
  console.log(`Клиент ${clientId} не переподключился в течение ${reconnectTimeout/1000} секунд`);
  
  // Проверяем снова, не подключился ли клиент за это время
  if (clients.has(clientId)) {
    clients.delete(clientId);
    
    // Оставляем историю сообщений - она будет доступна при повторном подключении
    // Историю удаляем только при явном удалении клиента админом
    
    // Уведомляем всех админов об отключении клиента
    broadcastToAdmins({
      type: 'clientDisconnected',
      clientId: clientId,
      timestamp: new Date().toISOString()
    });
    
    console.log(`Клиент ${clientId} удален после ожидания переподключения`);
  }
  
  // Удаляем таймер из Map
  clientReconnectTimers.delete(clientId);
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

// API для аутентификации
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  
  if (!password) {
    return res.status(400).json({ success: false, message: 'Пароль не указан' });
  }
  
  // Хешируем введённый пароль и сравниваем с хешем правильного пароля
  const passwordHash = hashPassword(password, SALT);
  
  if (passwordHash !== ADMIN_PASSWORD_HASH) {
    console.log('Неудачная попытка входа в админ-панель');
    return res.status(401).json({ success: false, message: 'Неверный пароль' });
  }
  
  // Создаём сессию
  const sessionId = uuidv4();
  const expires = Date.now() + SESSION_MAX_AGE;
  
  activeSessions.set(sessionId, { expires });
  
  // Устанавливаем cookie с идентификатором сессии
  res.setHeader('Set-Cookie', `adminSessionId=${sessionId}; Path=/; HttpOnly; Max-Age=${SESSION_MAX_AGE / 1000}; SameSite=Strict`);
  
  console.log('Успешный вход в админ-панель');
  res.status(200).json({ success: true });
});

// Выход из админ-панели
app.get('/api/logout', (req, res) => {
  const sessionId = req.cookies['adminSessionId'];
  
  if (sessionId) {
    activeSessions.delete(sessionId);
  }
  
  // Удаляем cookie сессии
  res.setHeader('Set-Cookie', 'adminSessionId=; Path=/; HttpOnly; Max-Age=0');
  
  res.redirect('/login');
});

// Защищаем маршрут админ-панели
app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

server.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});