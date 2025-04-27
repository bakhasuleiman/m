/**
 * Конфигурация GitHub базы данных
 * Файл используется для настройки соединения с GitHub репозиторием
 */

// Загружаем переменные среды из .env файла, если есть
require('dotenv').config();

// Параметры соединения с GitHub
const githubConfig = {
  // Токен для доступа к GitHub API
  token: process.env.GITHUB_TOKEN,
  
  // Владелец репозитория
  owner: process.env.GITHUB_OWNER,
  
  // Название репозитория
  repo: process.env.GITHUB_REPO,
  
  // Ветка для хранения данных (по умолчанию 'main')
  branch: process.env.GITHUB_BRANCH || 'main',
  
  // Папка для хранения данных
  dataFolder: process.env.GITHUB_DATA_FOLDER || 'data',
  
  // Интервал автосохранения (в миллисекундах) для debounce
  saveDebounceTime: parseInt(process.env.GITHUB_SAVE_DEBOUNCE || '1000', 10),
  
  // Включено ли автосохранение
  autoSave: process.env.GITHUB_AUTO_SAVE !== 'false'
};

// Экспортируем конфигурацию
module.exports = githubConfig; 