// ES модуль для загрузки client.js через букмарклет с помощью import()
(function() {
    // Определяем базовый URL для client.js относительно loader.js
    // Если loader.js загружен с https://mysite.com/loader.js,
    // то import.meta.url будет https://mysite.com/loader.js
    // Мы можем построить URL к client.js в той же папке.
    const loaderUrl = new URL(import.meta.url);
    const clientScriptUrl = new URL('client.js', loaderUrl).href;
  
    console.log(`Загрузка client.js с ${clientScriptUrl}`);
  
    // Проверяем, не был ли скрипт уже добавлен
    if (document.querySelector(`script[src="${clientScriptUrl}"]`)) {
      console.log('Скрипт client.js уже загружен.');
      return;
    }
  
    const script = document.createElement('script');
    script.src = clientScriptUrl;
    script.onerror = () => console.error(`Не удалось загрузить ${clientScriptUrl}`);
    script.onload = () => console.log(`Скрипт ${clientScriptUrl} успешно загружен.`);
    document.body.appendChild(script);
  })();
  
  // Экспортируем что-нибудь, чтобы файл считался модулем
  export const loaded = true;