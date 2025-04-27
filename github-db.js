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
   * Загружает все файлы из папки data
   * @returns {Promise<Object>} Объект, содержащий все загруженные данные
   */
  async loadAllData() {
    try {
      this.log('Загрузка всех данных из GitHub...');
      
      // Получаем список всех файлов в папке data
      const { data: contents } = await this.octokit.repos.getContent({
        owner: this.config.owner,
        repo: this.config.repo,
        path: this.config.dataFolder,
        ref: this.config.branch
      });
      
      // Отфильтровываем только JSON файлы
      const jsonFiles = contents.filter(item => 
        item.type === 'file' && item.name.endsWith('.json') && item.name !== 'README.md'
      );
      
      this.log(`Найдено ${jsonFiles.length} JSON файлов для загрузки`);
      
      // Загружаем содержимое каждого файла
      const result = {};
      
      for (const file of jsonFiles) {
        try {
          // Получаем имя коллекции из имени файла (до первого -)
          const fileName = file.name.replace('.json', '');
          const collectionName = fileName.split('-')[0];
          
          // Если эта коллекция еще не существует в результате, создаем ее
          if (!result[collectionName]) {
            result[collectionName] = new Map();
          }
          
          // Загружаем содержимое файла
          const { data: fileData } = await this.octokit.repos.getContent({
            owner: this.config.owner,
            repo: this.config.repo,
            path: file.path,
            ref: this.config.branch
          });
          
          // Декодируем содержимое из base64
          const content = Buffer.from(fileData.content, 'base64').toString();
          
          // Парсим JSON
          const data = JSON.parse(content);
          
          // Извлекаем ключ из имени файла (после первого -)
          const key = fileName.includes('-') ? fileName.split('-').slice(1).join('-') : data.id || fileName;
          
          // Добавляем данные в соответствующую коллекцию
          result[collectionName].set(key, data);
          
          this.log(`Загружены данные из файла ${file.name}, коллекция: ${collectionName}, ключ: ${key}`);
        } catch (fileError) {
          this.log(`Ошибка при загрузке файла ${file.name}: ${fileError.message}`, 'error');
          // Продолжаем загрузку других файлов
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
   * @returns {Promise<void>}
   */
  async saveRecord(collection, key, data) {
    // Добавляем операцию в очередь для избежания конфликтов при параллельном сохранении
    this.saveQueue = this.saveQueue.then(async () => {
      const operationId = ++this.operationCounter;
      this.log(`[${operationId}] Сохранение записи. Коллекция: ${collection}, ключ: ${key}`);
      
      try {
        // Обновляем SHA последнего коммита и дерева
        await this.refreshLatestCommitAndTree();
        
        // Подготавливаем данные для сохранения
        const content = JSON.stringify(data, null, 2);
        const fileName = `${collection}-${key}.json`;
        const path = `${this.config.dataFolder}/${fileName}`;
        
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
   * @returns {Promise<void>}
   */
  async deleteRecord(collection, key) {
    this.saveQueue = this.saveQueue.then(async () => {
      const operationId = ++this.operationCounter;
      this.log(`[${operationId}] Удаление записи. Коллекция: ${collection}, ключ: ${key}`);
      
      try {
        // В текущей реализации мы не удаляем файлы, а добавляем новые с пометкой deleted
        const fileName = `${collection}-${key}.json`;
        const path = `${this.config.dataFolder}/${fileName}`;
        
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
          await this.saveRecord(collection, key, data);
          
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