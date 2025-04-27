/**
 * GitHubDBManager - Главный класс для работы с GitHub базой данных в приложении
 * Управляет всеми коллекциями и их взаимодействием с GitHub
 */

const GitHubDatabase = require('./github-db');
const GitHubDBCollection = require('./github-db-collection');
const config = require('./github-db-config');

class GitHubDBManager {
  /**
   * Создает экземпляр менеджера базы данных
   * @param {Object} options Дополнительные настройки
   */
  constructor(options = {}) {
    this.config = {
      ...config,
      ...options
    };
    
    // Проверяем наличие обязательных параметров
    this.validateConfig();
    
    this.db = new GitHubDatabase(this.config);
    this.collections = {};
    this.initialized = false;
  }

  /**
   * Проверяет конфигурацию на наличие обязательных параметров
   * @throws {Error} Если отсутствуют обязательные параметры
   * @private
   */
  validateConfig() {
    const requiredParams = ['token', 'owner', 'repo'];
    const missingParams = requiredParams.filter(param => !this.config[param]);
    
    if (missingParams.length > 0) {
      throw new Error(`Отсутствуют обязательные параметры конфигурации: ${missingParams.join(', ')}`);
    }
  }

  /**
   * Инициализирует базу данных и загружает все коллекции
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) {
      console.log('GitHub DB Manager уже инициализирован');
      return;
    }
    
    console.log('Инициализация GitHub DB Manager...');
    
    try {
      // Инициализируем базу данных
      await this.db.initialize();
      
      // Загружаем данные из GitHub
      const data = await this.db.loadAllData();
      
      // Создаем коллекции из загруженных данных
      for (const collectionName in data) {
        this.collections[collectionName] = new GitHubDBCollection({
          name: collectionName,
          db: this.db,
          initialData: data[collectionName],
          autoSave: this.config.autoSave,
          saveDebounceTime: this.config.saveDebounceTime
        });
        
        console.log(`Создана коллекция '${collectionName}' с ${data[collectionName].size} записями`);
      }
      
      this.initialized = true;
      console.log('GitHub DB Manager успешно инициализирован');
    } catch (error) {
      console.error(`Ошибка при инициализации GitHub DB Manager: ${error.message}`);
      throw error;
    }
  }

  /**
   * Получает коллекцию по имени, создает новую если она не существует
   * @param {string} name Имя коллекции
   * @returns {GitHubDBCollection} Экземпляр коллекции
   */
  collection(name) {
    if (!this.initialized) {
      throw new Error('GitHub DB Manager не инициализирован. Вызовите initialize() перед использованием.');
    }
    
    // Если коллекция не существует, создаем новую
    if (!this.collections[name]) {
      this.collections[name] = new GitHubDBCollection({
        name,
        db: this.db,
        autoSave: this.config.autoSave,
        saveDebounceTime: this.config.saveDebounceTime
      });
      
      console.log(`Создана новая коллекция '${name}'`);
    }
    
    return this.collections[name];
  }

  /**
   * Проверяет, существует ли коллекция
   * @param {string} name Имя коллекции
   * @returns {boolean} true если коллекция существует, иначе false
   */
  hasCollection(name) {
    return !!this.collections[name];
  }

  /**
   * Возвращает список имен всех коллекций
   * @returns {Array<string>} Массив имен коллекций
   */
  getCollectionNames() {
    return Object.keys(this.collections);
  }

  /**
   * Сохраняет данные во всех коллекциях
   * @returns {Promise<void>}
   */
  async saveAll() {
    if (!this.initialized) {
      throw new Error('GitHub DB Manager не инициализирован. Вызовите initialize() перед использованием.');
    }
    
    console.log('Сохранение всех данных...');
    
    const promises = Object.values(this.collections).map(collection => 
      collection.saveAll()
    );
    
    await Promise.all(promises);
    console.log('Все данные успешно сохранены');
  }
}

// Экспортируем синглтон-экземпляр менеджера
const dbManager = new GitHubDBManager();
module.exports = dbManager; 