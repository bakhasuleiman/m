const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

// Настройка Express
const app = express();
// Включаем CORS для всех запросов
app.use(cors());

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
  updateInterval: 25 * 60 * 1000, // 25 минут в миллисекундах
  textOpacity: 0.7
};

// Хранилище таймеров для клиентов
const clientReconnectTimers = new Map();
const reconnectTimeout = 30000; // 30 секунд для переподключения

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
          const client = clients.get(data.clientId);
          if (client) {
            // Отправляем сообщение клиенту
            client.send(JSON.stringify({
              type: 'message',
              text: data.text,
              opacity: data.opacity || client.settings.textOpacity
            }));
            
            // Сохраняем сообщение в истории на сервере
            if (!clientsMessageHistory.has(data.clientId)) {
              clientsMessageHistory.set(data.clientId, []);
            }
            
            const messageId = uuidv4(); // Генерируем уникальный ID для сообщения
            
            clientsMessageHistory.get(data.clientId).push({
              id: messageId, // Добавляем ID сообщения для редактирования
              text: data.text,
              opacity: data.opacity || client.settings.textOpacity,
              timestamp: new Date().toISOString()
            });
            
            // Ограничиваем историю последними 100 сообщениями
            if (clientsMessageHistory.get(data.clientId).length > 100) {
              clientsMessageHistory.set(
                data.clientId, 
                clientsMessageHistory.get(data.clientId).slice(-100)
              );
            }
            
            console.log(`Сообщение отправлено клиенту ${data.clientId}`);
          }
        }
        else if (data.type === 'getMessageHistory') {
          // Запрос на получение истории сообщений для клиента
          const clientId = data.clientId;
          
          if (clientsMessageHistory.has(clientId)) {
            ws.send(JSON.stringify({
              type: 'adminMessageHistory',
              clientId: clientId,
              messages: clientsMessageHistory.get(clientId)
            }));
            console.log(`Отправлена история сообщений админу для клиента ${clientId}`);
          } else {
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
            
            console.log('Обновлены глобальные настройки по умолчанию');
          }
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
        
        // Очищаем предыдущий таймер, если он был
        if (clientReconnectTimers.has(ws.clientId)) {
          clearTimeout(clientReconnectTimers.get(ws.clientId));
        }
        
        // Устанавливаем новый таймер
        const timerId = setTimeout(() => {
          // Если клиент не переподключился за отведенное время, удаляем его
          if (clients.has(ws.clientId)) {
            clients.delete(ws.clientId);
            
            // НЕ удаляем историю сообщений, чтобы она сохранялась между сессиями
            // Историю удаляем только при явном удалении клиента админом
            
            // Уведомляем всех админов об отключении клиента
            broadcastToAdmins({
              type: 'clientDisconnected',
              clientId: ws.clientId
            });
            
            console.log(`Клиент ${ws.clientId} удален после ожидания переподключения`);
          }
          
          // Удаляем таймер из Map
          clientReconnectTimers.delete(ws.clientId);
        }, reconnectTimeout);
        
        // Сохраняем ID таймера
        clientReconnectTimers.set(ws.clientId, timerId);
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

// Маршруты Express
app.get('/client.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client.js'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

server.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});