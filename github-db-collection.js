/**
 * GitHubDBCollection - Класс для работы с коллекциями данных в GitHub базе данных
 * Представляет собой обертку вокруг Map с автосохранением
 */

class GitHubDBCollection {
  /**
   * Создает экземпляр коллекции
   * @param {Object} options Настройки коллекции
   * @param {string} options.name Название коллекции
   * @param {Object} options.db Экземпляр GitHubDatabase
   * @param {Map} options.initialData Начальные данные коллекции
   * @param {boolean} options.autoSave Автоматически сохранять данные при изменении
   * @param {number} options.saveDebounceTime Время задержки перед сохранением (мс)
   */
  constructor(options) {
    this.name = options.name;
    this.db = options.db;
    this.data = options.initialData || new Map();
    this.autoSave = options.autoSave !== undefined ? options.autoSave : true;
    this.saveDebounceTime = options.saveDebounceTime || 1000;
    this.saveTimers = new Map(); // ключ => таймер для debounce
    this.pendingSaves = new Set(); // ключи, ожидающие сохранения
    this.logger = options.db.config.logger; // Используем тот же логгер, что и в БД
    
    // Опции для группировки данных
    this.useGrouping = options.useGrouping || false;
    this.groupIdField = options.groupIdField || 'groupId';
    this.shardSize = options.shardSize || 100; // Количество записей в одном шарде
  }

  /**
   * Логирование операций
   * @param {string} message Сообщение для логирования
   * @param {string} level Уровень логирования ('info', 'error', 'warn')
   */
  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    this.logger(`[GitHub DB Collection:${this.name} ${level.toUpperCase()}] [${timestamp}] ${message}`);
  }

  /**
   * Получает данные по ключу
   * @param {string} key Ключ для получения данных
   * @returns {*} Данные, связанные с ключом
   */
  get(key) {
    return this.data.get(key);
  }

  /**
   * Устанавливает данные по ключу с опциональным автосохранением
   * @param {string} key Ключ для установки данных
   * @param {*} value Данные для сохранения
   * @param {boolean} [saveImmediately=false] Сохранить немедленно без debounce
   * @returns {GitHubDBCollection} This collection instance
   */
  set(key, value, saveImmediately = false) {
    this.data.set(key, value);
    
    if (this.autoSave) {
      if (saveImmediately) {
        this._saveRecord(key, value);
      } else {
        this._debounceSave(key, value);
      }
    }
    
    return this;
  }

  /**
   * Проверяет наличие данных по ключу
   * @param {string} key Ключ для проверки
   * @returns {boolean} true если данные существуют, иначе false
   */
  has(key) {
    return this.data.has(key);
  }

  /**
   * Удаляет данные по ключу
   * @param {string} key Ключ для удаления
   * @param {boolean} [markAsDeleted=true] Пометить как удаленные вместо физического удаления
   * @returns {boolean} true если данные были удалены, иначе false
   */
  delete(key, markAsDeleted = true) {
    const hadKey = this.data.delete(key);
    
    if (hadKey && this.autoSave) {
      // Очищаем существующий таймер сохранения, если был
      if (this.saveTimers.has(key)) {
        clearTimeout(this.saveTimers.get(key));
        this.saveTimers.delete(key);
      }
      
      // Удаляем из ожидающих сохранения
      this.pendingSaves.delete(key);
      
      // Запускаем процесс удаления записи
      if (markAsDeleted) {
        // Определяем, есть ли группировка для данной записи
        const options = this._getGroupingOptions(key);
        
        this.db.deleteRecord(this.name, key, options).catch(err => {
          this.log(`Ошибка при удалении записи ${key}: ${err.message}`, 'error');
        });
      }
    }
    
    return hadKey;
  }

  /**
   * Получает опции группировки для записи
   * @param {string} key Ключ записи
   * @returns {Object} Опции группировки { useGrouping, groupId }
   * @private
   */
  _getGroupingOptions(key) {
    if (!this.useGrouping) {
      return { useGrouping: false };
    }
    
    const value = this.data.get(key);
    
    if (!value || !value[this.groupIdField]) {
      return { useGrouping: false };
    }
    
    return {
      useGrouping: true,
      groupId: value[this.groupIdField]
    };
  }

  /**
   * Возвращает размер коллекции (количество записей)
   * @returns {number} Количество записей в коллекции
   */
  size() {
    return this.data.size;
  }

  /**
   * Возвращает массив ключей коллекции
   * @returns {Array} Массив ключей
   */
  keys() {
    return Array.from(this.data.keys());
  }

  /**
   * Возвращает массив значений коллекции
   * @returns {Array} Массив значений
   */
  values() {
    return Array.from(this.data.values());
  }

  /**
   * Возвращает массив пар [ключ, значение] коллекции
   * @returns {Array} Массив пар [ключ, значение]
   */
  entries() {
    return Array.from(this.data.entries());
  }

  /**
   * Применяет функцию к каждому элементу коллекции
   * @param {Function} callback Функция для применения к каждому элементу
   * @param {*} [thisArg] Значение, используемое как this при выполнении callback
   */
  forEach(callback, thisArg) {
    this.data.forEach(callback, thisArg);
  }

  /**
   * Фильтрует элементы коллекции и возвращает массив значений
   * @param {Function} predicate Функция фильтрации
   * @returns {Array} Массив отфильтрованных значений
   */
  filter(predicate) {
    const result = [];
    this.data.forEach((value, key) => {
      if (predicate(value, key, this.data)) {
        result.push(value);
      }
    });
    return result;
  }

  /**
   * Находит первый элемент, удовлетворяющий предикату
   * @param {Function} predicate Функция проверки
   * @returns {*} Найденный элемент или undefined
   */
  find(predicate) {
    for (const [key, value] of this.data.entries()) {
      if (predicate(value, key, this.data)) {
        return value;
      }
    }
    return undefined;
  }

  /**
   * Преобразует значения с применением функции и возвращает массив результатов
   * @param {Function} callback Функция преобразования
   * @returns {Array} Массив преобразованных значений
   */
  map(callback) {
    const result = [];
    this.data.forEach((value, key) => {
      result.push(callback(value, key, this.data));
    });
    return result;
  }

  /**
   * Очищает всю коллекцию
   * @param {boolean} [saveChanges=true] Сохранить изменения в GitHub
   */
  clear(saveChanges = true) {
    // Сохраняем ключи, прежде чем очистить данные
    const keys = Array.from(this.data.keys());
    
    // Очищаем все таймеры сохранения
    for (const timer of this.saveTimers.values()) {
      clearTimeout(timer);
    }
    this.saveTimers.clear();
    this.pendingSaves.clear();
    
    // Очищаем данные
    this.data.clear();
    
    // Если нужно сохранить изменения, помечаем каждый ключ как удаленный
    if (saveChanges && this.autoSave) {
      for (const key of keys) {
        const options = this._getGroupingOptions(key);
        this.db.deleteRecord(this.name, key, options).catch(err => {
          this.log(`Ошибка при удалении записи ${key} после очистки: ${err.message}`, 'error');
        });
      }
    }
  }

  /**
   * Принудительно сохраняет все ожидающие изменения
   * @returns {Promise<void>} Промис, который разрешается, когда все сохранения выполнены
   */
  async saveAll() {
    const pendingKeys = Array.from(this.pendingSaves);
    this.log(`Сохранение ${pendingKeys.length} записей...`);
    
    // Очищаем все таймеры сохранения
    for (const key of pendingKeys) {
      if (this.saveTimers.has(key)) {
        clearTimeout(this.saveTimers.get(key));
        this.saveTimers.delete(key);
      }
    }
    
    // Выполняем все ожидающие сохранения
    const savePromises = pendingKeys.map(key => {
      const value = this.data.get(key);
      if (value !== undefined) {
        this.pendingSaves.delete(key);
        return this._saveRecord(key, value);
      }
      return Promise.resolve();
    });
    
    await Promise.all(savePromises);
    this.log(`Сохранение всех записей завершено`);
  }

  /**
   * Создает и возвращает новую запись с автогенерируемым ID
   * @param {Object} data Данные для новой записи
   * @param {boolean} [saveImmediately=true] Сохранить немедленно
   * @returns {Object} Данные с новым ID
   */
  create(data, saveImmediately = true) {
    const timestamp = Date.now();
    const id = `${timestamp}-${Math.random().toString(36).substring(2, 9)}`;
    
    // Добавляем systemFields в запись
    const recordWithMeta = {
      ...data,
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    this.set(id, recordWithMeta, saveImmediately);
    return recordWithMeta;
  }

  /**
   * Обновляет существующую запись
   * @param {string} key Ключ записи для обновления
   * @param {Object} data Новые данные для записи
   * @param {boolean} [saveImmediately=true] Сохранить немедленно
   * @returns {Object|null} Обновленные данные или null, если запись не найдена
   */
  update(key, data, saveImmediately = true) {
    if (!this.has(key)) {
      return null;
    }
    
    const existingData = this.get(key);
    const updatedData = {
      ...existingData,
      ...data,
      updatedAt: new Date().toISOString()
    };
    
    this.set(key, updatedData, saveImmediately);
    return updatedData;
  }

  /**
   * Отложенное сохранение записи с debounce
   * @param {string} key Ключ записи
   * @param {*} value Данные для сохранения
   * @private
   */
  _debounceSave(key, value) {
    // Добавляем ключ в список ожидающих сохранения
    this.pendingSaves.add(key);
    
    // Если уже есть таймер для этого ключа, сбрасываем его
    if (this.saveTimers.has(key)) {
      clearTimeout(this.saveTimers.get(key));
    }
    
    // Устанавливаем новый таймер
    const timer = setTimeout(() => {
      this.saveTimers.delete(key);
      this.pendingSaves.delete(key);
      this._saveRecord(key, value);
    }, this.saveDebounceTime);
    
    this.saveTimers.set(key, timer);
  }

  /**
   * Сохраняет запись в GitHub
   * @param {string} key Ключ записи
   * @param {*} value Данные для сохранения
   * @returns {Promise<void>}
   * @private
   */
  async _saveRecord(key, value) {
    try {
      // Определяем опции группировки для данной записи
      const options = this._getGroupingOptions(key);
      
      // Сохраняем запись в соответствующую группу или в корень коллекции
      await this.db.saveRecord(this.name, key, value, options);
    } catch (error) {
      this.log(`Ошибка при сохранении записи ${key}: ${error.message}`, 'error');
      // Возвращаем ключ обратно в список ожидающих сохранения для повторной попытки
      this.pendingSaves.add(key);
      
      // Пытаемся снова сохранить через некоторое время
      setTimeout(() => {
        if (this.pendingSaves.has(key)) {
          this.log(`Повторная попытка сохранения записи ${key}...`);
          this._saveRecord(key, this.data.get(key));
        }
      }, 5000); // Повторная попытка через 5 секунд
    }
  }

  /**
   * Преобразует коллекцию в обычный объект
   * @returns {Object} Обычный объект {key: value}
   */
  toObject() {
    const obj = {};
    this.data.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }

  /**
   * Преобразует коллекцию в массив
   * @returns {Array} Массив значений
   */
  toArray() {
    return Array.from(this.data.values());
  }
}

module.exports = GitHubDBCollection; 