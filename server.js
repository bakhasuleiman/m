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

// Настройки по умолчанию
const defaultSettings = {
  updateInterval: 25 * 60 * 1000, // 25 минут в миллисекундах
  textOpacity: 0.7
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
          const clientId = uuidv4();
          ws.clientId = clientId;
          ws.role = 'client';
          ws.paused = false;
          ws.pageData = null;
          ws.settings = { ...defaultSettings };
          
          clients.set(clientId, ws);
          
          // Отправляем ID и настройки клиенту
          ws.send(JSON.stringify({
            type: 'registered',
            clientId,
            settings: ws.settings
          }));
          
          // Уведомляем всех админов о новом клиенте
          broadcastToAdmins({
            type: 'clientConnected',
            clientId,
            timestamp: new Date().toISOString()
          });
          
          console.log(`Клиент ${clientId} зарегистрирован`);
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
            client.send(JSON.stringify({
              type: 'message',
              text: data.text,
              opacity: data.opacity || client.settings.textOpacity
            }));
            
            console.log(`Сообщение отправлено клиенту ${data.clientId}`);
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
    } catch (error) {
      console.error('Ошибка обработки сообщения:', error);
    }
  });

  // Обработка отключения
  ws.on('close', () => {
    if (ws.role === 'client') {
      if (ws.clientId) {
        clients.delete(ws.clientId);
        
        // Уведомляем всех админов об отключении клиента
        broadcastToAdmins({
          type: 'clientDisconnected',
          clientId: ws.clientId
        });
        
        console.log(`Клиент ${ws.clientId} отключен`);
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

// Отправка сообщений всем админам
function broadcastToAdmins(message) {
  admins.forEach((admin) => {
    admin.send(JSON.stringify(message));
  });
}

// Маршруты для доступа к клиентскому скрипту и админ-панели
app.get('/client.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client.js'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Запуск сервера
server.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
}); 