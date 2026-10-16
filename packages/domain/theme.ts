// Runs before paint. Keep ES5 syntax so the Lite redirect can still run on old browsers.
export const themeScript = `(function(){var t;try{t=localStorage.getItem('ziyatai-theme')}catch(e){}if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.setAttribute('data-theme',t)})();`;
