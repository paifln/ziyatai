// Runs before paint. Keep ES5 syntax so the Lite redirect can still run on old browsers.
// Netlify can insert a hosting comment preceded by a newline into <head>.
// React expects Next's compact head tree; remove only insignificant whitespace
// before hydration, preserving comments, elements and the provider attribution.
export const themeScript = `(function(){var n=document.head.firstChild,next;while(n){next=n.nextSibling;if(n.nodeType===3&&!/\\S/.test(n.nodeValue||''))document.head.removeChild(n);n=next}var t;try{t=localStorage.getItem('ziyatai-theme')}catch(e){}if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.setAttribute('data-theme',t)})();`;
