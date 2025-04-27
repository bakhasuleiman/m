/**
 * GitHubDatabase - Класс для работы с GitHub как с базой данных
 * Реализует сохранение и загрузку данных в/из GitHub репозитория
 */

const { Octokit } = require('@octokit/rest');
const { createHash } = require('crypto');

class GitHubDatabase {
  /**
   * Создает экземпляр GitHubDatabase
   * @param {Object} config Конфигурация базы данных
   * @param {string} config.token GitHub токен с правами на запись
   * @param {string} config.owner Владелец репозитория
   * @param {string} config.repo Название репозитория
   * @param {string} config.branch Ветка для сохранения данных (по умолчанию 'main')
   * @param {string} config.dataFolder Папка для хранения данных (по умолчанию 'data')
   * @param {Function} config.logger Функция для логирования (по умолчанию console.log)
   */
  constructor(config) {
    this.config = {
      branch: 'main',
      dataFolder: 'data',
      logger: console.log,
      ...config
    };

    if (!this.config.token) {
      throw new Error('GitHub токен не указан');
    }

    if (!this.config.owner) {
      throw new Error('Владелец репозитория не указан');
    }

    if (!this.config.repo) {
      throw new Error('Название репозитория не указано');
    }

    this.octokit = new Octokit({
      auth: this.config.token
    });

    // Кэш для SHA последнего коммита
    this.latestCommitSha = null;
    // Кэш для SHA дерева
    this.latestTreeSha = null;
    
    // Очередь операций сохранения для избежания конфликтов
    this.saveQueue = Promise.resolve();
    
    // Счетчик операций для дебага
    this.operationCounter = 0;
  }

  /**
   * Логирование операций
   * @param {string} message Сообщение для логирования
   * @param {string} level Уровень логирования ('info', 'error', 'warn')
   */
  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    this.config.logger(`[GitHub DB ${level.toUpperCase()}] [${timestamp}] ${message}`);
  }

  /**
   * Инициализация базы данных - получение последнего коммита и дерева
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      this.log('Инициализация GitHub базы данных...');
      
      // Получаем последний коммит в указанной ветке
      const { data: refData } = await this.octokit.git.getRef({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: `heads/${this.config.branch}`
      });
      
      this.latestCommitSha = refData.object.sha;
      this.log(`Получен SHA последнего коммита: ${this.latestCommitSha}`);
      
      // Получаем последнее дерево
      const { data: commitData } = await this.octokit.git.getCommit({
        owner: this.config.owner,
        repo: this.config.repo,
        commit_sha: this.latestCommitSha
      });
      
      this.latestTreeSha = commitData.tree.sha;
      this.log(`Получен SHA дерева: ${this.latestTreeSha}`);
      
      // Создаем папку data, если она еще не существует
      await this.ensureDataFolder();
      
      this.log('Инициализация GitHub базы данных завершена успешно');
    } catch (error) {
      this.log(`Ошибка при инициализации GitHub DB: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Проверяет наличие папки data и создает ее, если нужно
   * @returns {Promise<void>}
   */
  async ensureDataFolder() {
    try {
      // Попробуем получить содержимое папки data
      await this.octokit.repos.getContent({
        owner: this.config.owner,
        repo: this.config.repo,
        path: this.config.dataFolder,
        ref: this.config.branch
      });
      
      this.log(`Папка ${this.config.dataFolder} уже существует`);
    } catch (error) {
      // Если папка не существует (статус 404), создаем ее
      if (error.status === 404) {
        this.log(`Папка ${this.config.dataFolder} не найдена, создаем...`);
        
        // Создаем пустой файл README.md в папке data
        await this.createFile(
          `${this.config.dataFolder}/README.md`,
          `# Данные приложения\nЭта папка содержит данные для приложения мониторинга веб-страниц.\nСоздана автоматически ${new Date().toISOString()}`
        );
        
        this.log(`Папка ${this.config.dataFolder} успешно создана`);
      } else {
        this.log(`Ошибка при проверке папки ${this.config.dataFolder}: ${error.message}`, 'error');
        throw error;
      }
    }
  }

  /**
   * Проверяет наличие папки коллекции и создает ее, если нужно
   * @param {string} collection Имя коллекции
   * @returns {Promise<void>}
   */
  async ensureCollectionFolder(collection) {
    const collectionPath = `${this.config.dataFolder}/${collection}`;
    try {
      // Попробуем получить содержимое папки коллекции
      await this.octokit.repos.getContent({
        owner: this.config.owner,
        repo: this.config.repo,
        path: collectionPath,
        ref: this.config.branch
      });
      
      this.log(`Папка коллекции ${collection} уже существует`);
    } catch (error) {
      // Если папка не существует (статус 404), создаем ее
      if (error.status === 404) {
        this.log(`Папка коллекции ${collection} не найдена, создаем...`);
        
        // Создаем пустой файл README.md в папке коллекции
        await this.createFile(
          `${collectionPath}/README.md`,
          `# Коллекция ${collection}\nСоздана автоматически ${new Date().toISOString()}`
        );
        
        // Создаем индексный файл для коллекции
        await this.createFile(
          `${collectionPath}/index.json`,
          JSON.stringify({
            name: collection,
            count: 0,
            created: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
          }, null, 2)
        );
        
        this.log(`Папка коллекции ${collection} успешно создана`);
      } else {
        this.log(`Ошибка при проверке папки коллекции ${collection}: ${error.message}`, 'error');
        throw error;
      }
    }
  }

  /**
   * Проверяет и при необходимости создает папку для группировки связанных данных
   * @param {string} collection Имя коллекции
   * @param {string} groupId Идентификатор группы (например, userId)
   * @returns {Promise<void>}
   */
  async ensureGroupFolder(collection, groupId) {
    const groupPath = `${this.config.dataFolder}/${collection}/${groupId}`;
    try {
      // Пробуем получить содержимое папки группы
      await this.octokit.repos.getContent({
        owner: this.config.owner,
        repo: this.config.repo,
        path: groupPath,
        ref: this.config.branch
      });
      
      this.log(`Папка группы ${groupPath} уже существует`);
    } catch (error) {
      // Если папка не существует (статус 404), создаем ее
      if (error.status === 404) {
        this.log(`Папка группы ${groupPath} не найдена, создаем...`);
        
        // Сначала убедимся, что папка коллекции существует
        await this.ensureCollectionFolder(collection);
        
        // Создаем пустой файл README.md в папке группы
        await this.createFile(
          `${groupPath}/README.md`,
          `# Группа ${groupId} в коллекции ${collection}\nСоздана автоматически ${new Date().toISOString()}`
        );
        
        this.log(`Папка группы ${groupPath} успешно создана`);
      } else {
        this.log(`Ошибка при проверке папки группы ${groupPath}: ${error.message}`, 'error');
        throw error;
      }
    }
  }

  /**
   * Получает путь к файлу записи
   * @param {string} collection Имя коллекции
   * @param {string} key Ключ записи
   * @param {Object} options Дополнительные опции
   * @param {boolean} options.useGrouping Использовать группировку (по умолчанию false)
   * @param {string} options.groupId Идентификатор группы (если useGrouping=true)
   * @returns {string} Путь к файлу
   */
  getRecordPath(collection, key, options = {}) {
    const { useGrouping = false, groupId = null } = options;
    
    if (useGrouping && groupId) {
      return `${this.config.dataFolder}/${collection}/${groupId}/${key}.json`;
    } else {
      return `${this.config.dataFolder}/${collection}/${key}.json`;
    }
  }

  /**
   * Обновляет индексный файл коллекции
   * @param {string} collection Имя коллекции
   * @returns {Promise<void>}
   */
  async updateCollectionIndex(collection) {
    try {
      const collectionPath = `${this.config.dataFolder}/${collection}`;
      
      // Получаем список всех файлов в коллекции
      const files = await this.listFilesInCollection(collection);
      
      // Фильтруем только JSON файлы (кроме index.json и README.md)
      const jsonFiles = files.filter(file => 
        file.endsWith('.json') && 
        file !== 'index.json' && 
        file !== 'README.md'
      );
      
      // Создаем обновленный индекс
      const index = {
        name: collection,
        count: jsonFiles.length,
        lastUpdated: new Date().toISOString(),
        files: jsonFiles.map(file => ({
          id: file.replace('.json', ''),
          path: `${collectionPath}/${file}`
        }))
      };
      
      // Сохраняем обновленный индекс
      await this.createFile(
        `${collectionPath}/index.json`,
        JSON.stringify(index, null, 2)
      );
      
      this.log(`Индекс коллекции ${collection} успешно обновлен`);
    } catch (error) {
      this.log(`Ошибка при обновлении индекса коллекции ${collection}: ${error.message}`, 'error');
      // Не выбрасываем ошибку, чтобы не прерывать основные операции
    }
  }

  /**
   * Получает список файлов в коллекции
   * @param {string} collection Имя коллекции
   * @returns {Promise<string[]>} Массив имен файлов
   */
  async listFilesInCollection(collection) {
    try {
      const collectionPath = `${this.config.dataFolder}/${collection}`;
      
      // Получаем содержимое папки коллекции
      const { data: contents } = await this.octokit.repos.getContent({
        owner: this.config.owner,
        repo: this.config.repo,
        path: collectionPath,
        ref: this.config.branch
      });
      
      // Фильтруем только файлы и возвращаем их имена
      return contents
        .filter(item => item.type === 'file')
        .map(item => item.name);
    } catch (error) {
      if (error.status === 404) {
        // Если папка не существует, возвращаем пустой массив
        return [];
      }
      throw error;
    }
  }

  /**
   * Получает список всех коллекций
   * @returns {Promise<string[]>} Массив имен коллекций
   */
  async listCollections() {
    try {
      // Получаем содержимое папки данных
      const { data: contents } = await this.octokit.repos.getContent({
        owner: this.config.owner,
        repo: this.config.repo,
        path: this.config.dataFolder,
        ref: this.config.branch
      });
      
      // Фильтруем только папки и возвращаем их имена
      return contents
        .filter(item => item.type === 'dir')
        .map(item => item.name);
    } catch (error) {
      if (error.status === 404) {
        // Если папка данных не существует, возвращаем пустой массив
        return [];
      }
      throw error;
    }
  }

  /**
   * Загружает все файлы из папки data
   * @returns {Promise<Object>} Объект, содержащий все загруженные данные
   */
  async loadAllData() {
    try {
      this.log('Загрузка всех данных из GitHub...');
      
      // Получаем список всех коллекций
      const collections = await this.listCollections();
      this.log(`Найдено ${collections.length} коллекций`);
      
      const result = {};
      
      // Загружаем данные из каждой коллекции
      for (const collection of collections) {
        result[collection] = new Map();
        
        try {
          // Получаем список файлов в коллекции
          const files = await this.listFilesInCollection(collection);
          
          // Фильтруем только JSON файлы (кроме index.json и README.md)
          const jsonFiles = files.filter(file => 
            file.endsWith('.json') && 
            file !== 'index.json' && 
            file !== 'README.md'
          );
          
          this.log(`Найдено ${jsonFiles.length} JSON файлов в коллекции ${collection}`);
          
          // Загружаем каждый файл
          for (const file of jsonFiles) {
            try {
              const filePath = `${this.config.dataFolder}/${collection}/${file}`;
              
              // Загружаем содержимое файла
              const { data: fileData } = await this.octokit.repos.getContent({
                owner: this.config.owner,
                repo: this.config.repo,
                path: filePath,
                ref: this.config.branch
              });
              
              // Декодируем содержимое из base64
              const content = Buffer.from(fileData.content, 'base64').toString();
              
              // Парсим JSON
              const data = JSON.parse(content);
              
              // Пропускаем удаленные записи
              if (data.__deleted) {
                continue;
              }
              
              // Извлекаем ключ из имени файла
              const key = file.replace('.json', '');
              
              // Добавляем данные в соответствующую коллекцию
              result[collection].set(key, data);
              
              this.log(`Загружены данные из файла ${file}, коллекция: ${collection}, ключ: ${key}`);
            } catch (fileError) {
              this.log(`Ошибка при загрузке файла ${file}: ${fileError.message}`, 'error');
              // Продолжаем загрузку других файлов
            }
          }
        } catch (collectionError) {
          this.log(`Ошибка при загрузке коллекции ${collection}: ${collectionError.message}`, 'error');
          // Продолжаем загрузку других коллекций
        }
      }
      
      this.log('Загрузка всех данных из GitHub завершена успешно');
      return result;
    } catch (error) {
      this.log(`Ошибка при загрузке данных из GitHub: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Создает или обновляет запись в GitHub
   * @param {string} collection Название коллекции данных
   * @param {string} key Ключ записи
   * @param {Object} data Данные для сохранения
   * @param {Object} options Дополнительные опции
   * @param {boolean} options.useGrouping Использовать группировку (по умолчанию false)
   * @param {string} options.groupId Идентификатор группы (если useGrouping=true)
   * @returns {Promise<void>}
   */
  async saveRecord(collection, key, data, options = {}) {
    const { useGrouping = false, groupId = null } = options;
    
    // Добавляем операцию в очередь для избежания конфликтов при параллельном сохранении
    this.saveQueue = this.saveQueue.then(async () => {
      const operationId = ++this.operationCounter;
      this.log(`[${operationId}] Сохранение записи. Коллекция: ${collection}, ключ: ${key}`);
      
      try {
        // Обновляем SHA последнего коммита и дерева
        await this.refreshLatestCommitAndTree();
        
        // Убедимся, что папка коллекции существует
        await this.ensureCollectionFolder(collection);
        
        // Если используется группировка, убедимся, что папка группы существует
        if (useGrouping && groupId) {
          await this.ensureGroupFolder(collection, groupId);
        }
        
        // Подготавливаем данные для сохранения
        const content = JSON.stringify(data, null, 2);
        
        // Получаем путь к файлу
        const path = this.getRecordPath(collection, key, { useGrouping, groupId });
        
        // Создаем блоб с данными
        const { data: blobData } = await this.octokit.git.createBlob({
          owner: this.config.owner,
          repo: this.config.repo,
          content,
          encoding: 'utf-8'
        });
        
        const blobSha = blobData.sha;
        this.log(`[${operationId}] Создан блоб с SHA: ${blobSha}`);
        
        // Создаем новое дерево с нашим файлом
        const { data: newTreeData } = await this.octokit.git.createTree({
          owner: this.config.owner,
          repo: this.config.repo,
          base_tree: this.latestTreeSha,
          tree: [
            {
              path,
              mode: '100644', // файл (blob)
              type: 'blob',
              sha: blobSha
            }
          ]
        });
        
        const newTreeSha = newTreeData.sha;
        this.log(`[${operationId}] Создано новое дерево с SHA: ${newTreeSha}`);
        
        // Создаем новый коммит
        const { data: newCommitData } = await this.octokit.git.createCommit({
          owner: this.config.owner,
          repo: this.config.repo,
          message: `Update ${collection} record: ${key}`,
          tree: newTreeSha,
          parents: [this.latestCommitSha]
        });
        
        const newCommitSha = newCommitData.sha;
        this.log(`[${operationId}] Создан новый коммит с SHA: ${newCommitSha}`);
        
        // Обновляем указатель ветки на новый коммит
        await this.octokit.git.updateRef({
          owner: this.config.owner,
          repo: this.config.repo,
          ref: `heads/${this.config.branch}`,
          sha: newCommitSha
        });
        
        // Обновляем кэш
        this.latestCommitSha = newCommitSha;
        this.latestTreeSha = newTreeSha;
        
        // Обновляем индекс коллекции
        await this.updateCollectionIndex(collection);
        
        this.log(`[${operationId}] Запись успешно сохранена в GitHub`);
      } catch (error) {
        this.log(`[${operationId}] Ошибка при сохранении записи: ${error.message}`, 'error');
        throw error;
      }
    }).catch(error => {
      this.log(`Ошибка в очереди сохранения: ${error.message}`, 'error');
      // Восстанавливаем очередь после ошибки
      this.saveQueue = Promise.resolve();
      throw error;
    });
    
    // Возвращаем промис из очереди
    return this.saveQueue;
  }

  /**
   * Обновляет SHA последнего коммита и дерева
   * @returns {Promise<void>}
   */
  async refreshLatestCommitAndTree() {
    try {
      // Получаем последний коммит в указанной ветке
      const { data: refData } = await this.octokit.git.getRef({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: `heads/${this.config.branch}`
      });
      
      this.latestCommitSha = refData.object.sha;
      
      // Получаем последнее дерево
      const { data: commitData } = await this.octokit.git.getCommit({
        owner: this.config.owner,
        repo: this.config.repo,
        commit_sha: this.latestCommitSha
      });
      
      this.latestTreeSha = commitData.tree.sha;
    } catch (error) {
      this.log(`Ошибка при обновлении SHA: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Создает новый файл в репозитории
   * @param {string} path Путь к файлу
   * @param {string} content Содержимое файла
   * @returns {Promise<void>}
   */
  async createFile(path, content) {
    try {
      await this.refreshLatestCommitAndTree();
      
      // Создаем блоб с данными
      const { data: blobData } = await this.octokit.git.createBlob({
        owner: this.config.owner,
        repo: this.config.repo,
        content,
        encoding: 'utf-8'
      });
      
      // Создаем новое дерево с нашим файлом
      const { data: newTreeData } = await this.octokit.git.createTree({
        owner: this.config.owner,
        repo: this.config.repo,
        base_tree: this.latestTreeSha,
        tree: [
          {
            path,
            mode: '100644', // файл (blob)
            type: 'blob',
            sha: blobData.sha
          }
        ]
      });
      
      // Создаем новый коммит
      const { data: newCommitData } = await this.octokit.git.createCommit({
        owner: this.config.owner,
        repo: this.config.repo,
        message: `Create file: ${path}`,
        tree: newTreeData.sha,
        parents: [this.latestCommitSha]
      });
      
      // Обновляем указатель ветки на новый коммит
      await this.octokit.git.updateRef({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: `heads/${this.config.branch}`,
        sha: newCommitData.sha
      });
      
      // Обновляем кэш
      this.latestCommitSha = newCommitData.sha;
      this.latestTreeSha = newTreeData.sha;
      
      this.log(`Файл ${path} успешно создан`);
    } catch (error) {
      this.log(`Ошибка при создании файла ${path}: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Удаляет запись из GitHub
   * @param {string} collection Название коллекции данных
   * @param {string} key Ключ записи
   * @param {Object} options Дополнительные опции
   * @param {boolean} options.useGrouping Использовать группировку (по умолчанию false)
   * @param {string} options.groupId Идентификатор группы (если useGrouping=true) 
   * @returns {Promise<void>}
   */
  async deleteRecord(collection, key, options = {}) {
    const { useGrouping = false, groupId = null } = options;
    
    this.saveQueue = this.saveQueue.then(async () => {
      const operationId = ++this.operationCounter;
      this.log(`[${operationId}] Удаление записи. Коллекция: ${collection}, ключ: ${key}`);
      
      try {
        // Получаем путь к файлу
        const path = this.getRecordPath(collection, key, { useGrouping, groupId });
        
        // Получаем текущие данные файла
        try {
          const { data: fileData } = await this.octokit.repos.getContent({
            owner: this.config.owner,
            repo: this.config.repo,
            path,
            ref: this.config.branch
          });
          
          // Декодируем содержимое из base64
          const content = Buffer.from(fileData.content, 'base64').toString();
          
          // Парсим JSON
          const data = JSON.parse(content);
          
          // Помечаем запись как удаленную
          data.__deleted = true;
          data.__deletedAt = new Date().toISOString();
          
          // Сохраняем обновленные данные
          await this.saveRecord(collection, key, data, { useGrouping, groupId });
          
          // Обновляем индекс коллекции
          await this.updateCollectionIndex(collection);
          
          this.log(`[${operationId}] Запись помечена как удаленная`);
        } catch (error) {
          if (error.status === 404) {
            this.log(`[${operationId}] Файл ${path} не найден, запись считается удаленной`);
          } else {
            throw error;
          }
        }
      } catch (error) {
        this.log(`[${operationId}] Ошибка при удалении записи: ${error.message}`, 'error');
        throw error;
      }
    }).catch(error => {
      this.log(`Ошибка в очереди удаления: ${error.message}`, 'error');
      // Восстанавливаем очередь после ошибки
      this.saveQueue = Promise.resolve();
      throw error;
    });
    
    // Возвращаем промис из очереди
    return this.saveQueue;
  }

  /**
   * Сохраняет связанные данные группы (например, пользовательские данные)
   * @param {string} collection Имя коллекции 
   * @param {string} groupId Идентификатор группы (например, userId)
   * @param {string} dataType Тип данных (например, 'profile', 'settings')
   * @param {Object} data Данные для сохранения
   * @returns {Promise<void>}
   */
  async saveGroupData(collection, groupId, dataType, data) {
    try {
      // Убедимся, что папка группы существует
      await this.ensureGroupFolder(collection, groupId);
      
      // Сохраняем данные как отдельный файл в папке группы
      await this.saveRecord(collection, dataType, data, {
        useGrouping: true,
        groupId
      });
      
      this.log(`Данные группы сохранены: ${collection}/${groupId}/${dataType}`);
    } catch (error) {
      this.log(`Ошибка при сохранении данных группы: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Загружает связанные данные группы
   * @param {string} collection Имя коллекции
   * @param {string} groupId Идентификатор группы
   * @param {string} dataType Тип данных (например, 'profile', 'settings')
   * @returns {Promise<Object|null>} Загруженные данные или null если не найдены
   */
  async loadGroupData(collection, groupId, dataType) {
    try {
      const filePath = `${this.config.dataFolder}/${collection}/${groupId}/${dataType}.json`;
      
      const { data: fileData } = await this.octokit.repos.getContent({
        owner: this.config.owner,
        repo: this.config.repo,
        path: filePath,
        ref: this.config.branch
      });
      
      // Декодируем содержимое из base64
      const content = Buffer.from(fileData.content, 'base64').toString();
      
      // Парсим JSON
      const data = JSON.parse(content);
      
      // Проверяем, не помечена ли запись как удаленная
      if (data.__deleted) {
        return null;
      }
      
      return data;
    } catch (error) {
      if (error.status === 404) {
        // Если файл не найден, возвращаем null
        return null;
      }
      
      this.log(`Ошибка при загрузке данных группы: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Вычисляет хеш данных для предотвращения дублирования
   * @param {Object} data Данные для хеширования
   * @returns {string} SHA-256 хеш данных
   */
  static calculateDataHash(data) {
    const content = JSON.stringify(data);
    return createHash('sha256').update(content).digest('hex');
  }
}

module.exports = GitHubDatabase; 