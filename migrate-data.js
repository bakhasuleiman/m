/**
 * Скрипт для миграции данных из старой структуры хранения в новую иерархическую структуру
 * Запуск: node migrate-data.js
 */

require('dotenv').config();
const dbManager = require('./github-db-manager');

// Проверка, что все переменные окружения настроены
function checkEnvironment() {
  const requiredVars = ['GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO'];
  const missing = requiredVars.filter(v => !process.env[v]);
  
  if (missing.length > 0) {
    console.error(`Отсутствуют обязательные переменные окружения: ${missing.join(', ')}`);
    console.error('Создайте файл .env на основе .env.example и заполните необходимые данные.');
    process.exit(1);
  }
}

// Обработчик для корректной обработки ошибок в асинхронных функциях
process.on('unhandledRejection', (reason, promise) => {
  console.error('Необработанная ошибка в Promise:', reason);
  process.exit(1);
});

// Функция миграции данных
async function migrateData() {
  console.log('Проверка окружения...');
  checkEnvironment();
  
  console.log('Инициализация базы данных...');
  await dbManager.initialize();
  
  // Запрос подтверждения перед миграцией
  console.log('\n========== ВНИМАНИЕ ==========');
  console.log('Миграция данных может занять продолжительное время в зависимости от объема данных.');
  console.log('Будет создана резервная копия всех данных перед началом миграции.');
  console.log('Рекомендуется выполнять миграцию когда система не используется активно.');
  console.log('================================\n');
  
  // Запускаем процесс миграции после подтверждения через stdin
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  readline.question('Вы хотите продолжить? (y/n) ', async (answer) => {
    if (answer.toLowerCase() === 'y') {
      console.log('Начинаю процесс миграции...');
      try {
        await dbManager.migrateToStructuredStorage(true);
        console.log('\nМиграция успешно завершена!');
      } catch (error) {
        console.error('Ошибка при миграции:', error);
      }
    } else {
      console.log('Миграция отменена.');
    }
    
    readline.close();
    process.exit(0);
  });
}

// Запуск миграции
migrateData(); 