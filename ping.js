const https = require('https');
const http = require('http');

// URL вашего приложения на Render.com
const APP_URL = process.env.RENDER_EXTERNAL_URL || 'https://zxc11.space';

// Функция для выполнения пинга
function pingApp() {
    const protocol = APP_URL.startsWith('https') ? https : http;
    
    protocol.get(APP_URL, (res) => {
        console.log(`Ping successful at ${new Date().toISOString()}. Status: ${res.statusCode}`);
    }).on('error', (err) => {
        console.error(`Ping failed: ${err.message}`);
    });
}

// Пингуем каждые 14 минут (840000 мс)
// Render.com засыпает после 15 минут неактивности
setInterval(pingApp, 640000);

// Выполняем первый пинг сразу после запуска
pingApp();

console.log('Ping service started'); 