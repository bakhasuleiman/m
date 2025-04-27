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
    
    // Конфигурация шардирования и группировки
    this.defaultCollectionConfig = {
      users: { useGrouping: true, groupIdField: 'id' },
      activeSessions: { useGrouping: true, groupIdField: 'userId' },
      clientsMessageHistory: { useGrouping: true, groupIdField: 'clientId' }
    };
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
        const collectionConfig = this.defaultCollectionConfig[collectionName] || {};
        
        this.collections[collectionName] = new GitHubDBCollection({
          name: collectionName,
          db: this.db,
          initialData: data[collectionName],
          autoSave: this.config.autoSave,
          saveDebounceTime: this.config.saveDebounceTime,
          ...collectionConfig
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
   * @param {Object} options Дополнительные опции коллекции
   * @param {boolean} options.useGrouping Использовать группировку данных
   * @param {string} options.groupIdField Поле для группировки
   * @param {number} options.shardSize Размер шарда для коллекции
   * @returns {GitHubDBCollection} Экземпляр коллекции
   */
  collection(name, options = {}) {
    if (!this.initialized) {
      throw new Error('GitHub DB Manager не инициализирован. Вызовите initialize() перед использованием.');
    }
    
    // Если коллекция не существует, создаем новую
    if (!this.collections[name]) {
      // Получаем конфигурацию по умолчанию для коллекции или пустой объект
      const defaultConfig = this.defaultCollectionConfig[name] || {};
      
      this.collections[name] = new GitHubDBCollection({
        name,
        db: this.db,
        autoSave: this.config.autoSave,
        saveDebounceTime: this.config.saveDebounceTime,
        ...defaultConfig,
        ...options
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
  
  /**
   * Сохраняет связанные данные в соответствующих группах
   * @param {string} collection Имя коллекции
   * @param {string} groupId Идентификатор группы
   * @param {string} dataType Тип данных
   * @param {Object} data Данные для сохранения
   * @returns {Promise<void>}
   */
  async saveGroupData(collection, groupId, dataType, data) {
    if (!this.initialized) {
      throw new Error('GitHub DB Manager не инициализирован. Вызовите initialize() перед использованием.');
    }
    
    await this.db.saveGroupData(collection, groupId, dataType, data);
  }
  
  /**
   * Загружает связанные данные из соответствующей группы
   * @param {string} collection Имя коллекции
   * @param {string} groupId Идентификатор группы
   * @param {string} dataType Тип данных
   * @returns {Promise<Object|null>} Загруженные данные или null если не найдены
   */
  async loadGroupData(collection, groupId, dataType) {
    if (!this.initialized) {
      throw new Error('GitHub DB Manager не инициализирован. Вызовите initialize() перед использованием.');
    }
    
    return await this.db.loadGroupData(collection, groupId, dataType);
  }
  
  /**
   * Создает файл с метаданными базы данных
   * @returns {Promise<void>}
   */
  async createDatabaseMetadata() {
    if (!this.initialized) {
      throw new Error('GitHub DB Manager не инициализирован. Вызовите initialize() перед использованием.');
    }
    
    const metadata = {
      version: "1.0.0",
      collections: this.getCollectionNames(),
      created: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      config: {
        useStructuredStorage: true,
        useGrouping: true,
        shardingEnabled: true
      }
    };
    
    await this.db.createFile(
      `${this.db.config.dataFolder}/.dbconfig.json`,
      JSON.stringify(metadata, null, 2)
    );
    
    console.log('Метаданные базы данных успешно созданы');
  }

  /**
   * Мигрирует данные из старой структуры в новую иерархическую структуру
   * Внимание: эта операция может занять длительное время в зависимости от объема данных
   * @param {boolean} [backupFirst=true] Создать резервную копию перед миграцией
   * @returns {Promise<void>}
   */
  async migrateToStructuredStorage(backupFirst = true) {
    if (!this.initialized) {
      throw new Error('GitHub DB Manager не инициализирован. Вызовите initialize() перед использованием.');
    }
    
    console.log('Начало миграции данных в структурированное хранилище...');
    
    try {
      // 1. Создаем резервную копию данных
      if (backupFirst) {
        console.log('Создание резервной копии данных...');
        await this._createBackup();
        console.log('Резервная копия данных создана успешно');
      }
      
      // 2. Получаем содержимое папки data для нахождения файлов старого формата
      const { data: contents } = await this.db.octokit.repos.getContent({
        owner: this.db.config.owner,
        repo: this.db.config.repo,
        path: this.db.config.dataFolder,
        ref: this.db.config.branch
      });
      
      // 3. Находим файлы старого формата (collection-key.json)
      const oldFormatFiles = contents.filter(item => 
        item.type === 'file' && 
        item.name.endsWith('.json') && 
        item.name !== 'README.md' &&
        item.name.includes('-')
      );
      
      console.log(`Найдено ${oldFormatFiles.length} файлов в старом формате`);
      
      let migratedCount = 0;
      
      // 4. Для каждого файла в старом формате
      for (const file of oldFormatFiles) {
        try {
          // Извлекаем имя коллекции и ключ из имени файла
          const fileName = file.name.replace('.json', '');
          const parts = fileName.split('-');
          const collectionName = parts[0];
          const key = parts.slice(1).join('-');
          
          // Загружаем содержимое файла
          const { data: fileData } = await this.db.octokit.repos.getContent({
            owner: this.db.config.owner,
            repo: this.db.config.repo,
            path: file.path,
            ref: this.db.config.branch
          });
          
          // Декодируем содержимое из base64
          const content = Buffer.from(fileData.content, 'base64').toString();
          
          // Парсим JSON
          const data = JSON.parse(content);
          
          // Пропускаем удаленные записи
          if (data.__deleted) {
            console.log(`Пропуск удаленной записи: ${fileName}`);
            continue;
          }
          
          // Определяем параметры группировки для данной коллекции
          const collectionConfig = this.defaultCollectionConfig[collectionName] || {};
          const useGrouping = collectionConfig.useGrouping || false;
          const groupIdField = collectionConfig.groupIdField || 'id';
          
          // Определяем ID группы для группировки (если нужна)
          let groupId = null;
          if (useGrouping && data[groupIdField]) {
            groupId = data[groupIdField];
          }
          
          // Сохраняем данные в новой структуре
          const options = { useGrouping, groupId };
          await this.db.saveRecord(collectionName, key, data, options);
          
          migratedCount++;
          console.log(`Перенесена запись ${migratedCount}: ${collectionName}/${key}`);
          
        } catch (fileError) {
          console.error(`Ошибка при миграции файла ${file.name}: ${fileError.message}`);
          // Продолжаем миграцию других файлов
        }
      }
      
      // 5. Обновляем индексы для всех коллекций
      const collections = await this.db.listCollections();
      for (const collection of collections) {
        await this.db.updateCollectionIndex(collection);
      }
      
      // 6. Создаем файл метаданных базы данных
      await this.createDatabaseMetadata();
      
      console.log(`Миграция завершена. Перенесено ${migratedCount} записей.`);
    } catch (error) {
      console.error(`Ошибка при миграции данных: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Создает резервную копию всех данных перед миграцией
   * @returns {Promise<void>}
   * @private
   */
  async _createBackup() {
    // Создаем папку для резервных копий
    const backupFolderPath = `${this.db.config.dataFolder}/backups`;
    
    try {
      // Проверяем, существует ли папка backups
      await this.db.octokit.repos.getContent({
        owner: this.db.config.owner,
        repo: this.db.config.repo,
        path: backupFolderPath,
        ref: this.db.config.branch
      });
    } catch (error) {
      if (error.status === 404) {
        // Создаем папку backups
        await this.db.createFile(
          `${backupFolderPath}/README.md`,
          `# Резервные копии\nЭта папка содержит резервные копии данных.\nСоздана автоматически ${new Date().toISOString()}`
        );
      } else {
        throw error;
      }
    }
    
    // Создаем резервную копию с текущей датой
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `backup-${timestamp}.json`;
    
    // Получаем все данные из всех коллекций
    const backupData = {};
    
    for (const name of this.getCollectionNames()) {
      backupData[name] = this.collection(name).toObject();
    }
    
    // Сохраняем резервную копию в файл
    await this.db.createFile(
      `${backupFolderPath}/${backupFileName}`,
      JSON.stringify(backupData, null, 2)
    );
    
    console.log(`Резервная копия создана: ${backupFolderPath}/${backupFileName}`);
  }
}

// Экспортируем синглтон-экземпляр менеджера
const dbManager = new GitHubDBManager();
module.exports = dbManager; 