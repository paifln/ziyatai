/** Runs before hydration. Keep this small script in ES5 syntax. */
export const browserSupportScript = String.raw`(function(){
var ua=navigator.userAgent,m,old=false;
if(/MSIE |Trident\//.test(ua))old=true;
m=ua.match(/(?:Chrome|Chromium|Edg)\/(\d+)/);if(m&&Number(m[1])<111)old=true;
m=ua.match(/Firefox\/(\d+)/);if(m&&Number(m[1])<111)old=true;
m=ua.match(/Version\/(\d+)\.(\d+).*Safari/);if(m&&(Number(m[1])<16||(Number(m[1])===16&&Number(m[2])<4)))old=true;
m=ua.match(/(?:CPU (?:iPhone )?OS|iPhone OS) (\d+)[._](\d+)/);if(m&&(Number(m[1])<16||(Number(m[1])===16&&Number(m[2])<4)))old=true;
if(old)location.replace('/lite/'+location.search);
})();`;
