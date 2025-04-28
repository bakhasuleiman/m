const { fork } = require('child_process');
const path = require('path');

// Запускаем ping.js как отдельный процесс
const pingProcess = fork(path.join(__dirname, 'ping.js'));

// Обработка ошибок в дочернем процессе
pingProcess.on('error', (err) => {
    console.error('Ping worker error:', err);
});

// Обработка завершения дочернего процесса
pingProcess.on('exit', (code) => {
    console.log(`Ping worker exited with code ${code}`);
    // Перезапускаем процесс в случае ошибки
    if (code !== 0) {
        console.log('Restarting ping worker...');
        fork(path.join(__dirname, 'ping.js'));
    }
});

console.log('Ping worker started'); 