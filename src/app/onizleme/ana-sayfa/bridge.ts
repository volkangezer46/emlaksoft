/**
 * Önizleme köprüsü (≤2 KB, satır içi; CSP `script-src 'unsafe-inline'` kapsamında, next.config değişmez).
 * YALNIZ yönetim ekranındaki iframe içinde çalışır (`parent !== window`): `data-cms-path` taşıyan öğenin üstüne gelince
 * çerçeve çizer, tıklamada `parent.postMessage({type:"cms-select", path}, "*")` gönderir. Hedef köken "*" çünkü iframe
 * `sandbox="allow-scripts"` ile (allow-same-origin YOK) opak kökende çalışır; editör mesajı `event.source` ve yol izin
 * listesiyle doğrular. İframe içinde düzenleme YOK: yazma her zaman yan paneldeki doğrulamalı alandan yapılır.
 * Çerçeve öğesi ilk üzerine gelişte (hidrasyondan sonra) oluşturulur ve React yeniden çizerse yeniden eklenir;
 * dinleyiciler belgededir.
 */
export const PREVIEW_BRIDGE_JS = `(function(){
if(window.parent===window)return;
var b=null;
function F(){if(!b||!b.isConnected){b=document.createElement("div");b.setAttribute("aria-hidden","true");b.style.cssText="position:absolute;display:none;pointer-events:none;z-index:2147483647;border:2px solid #1d5cff;border-radius:6px;background:rgba(29,92,255,.06);box-sizing:border-box";document.body.appendChild(b)}return b}
function hit(e){var t=e.target;return t&&t.closest?t.closest("[data-cms-path]"):null}
function box(el){var r=el.getBoundingClientRect();if(r.width||r.height)return r;var k=el.children,l=1e9,t=1e9,R=-1e9,B=-1e9;for(var i=0;i<k.length;i++){var c=k[i].getBoundingClientRect();if(!c.width&&!c.height)continue;l=Math.min(l,c.left);t=Math.min(t,c.top);R=Math.max(R,c.right);B=Math.max(B,c.bottom)}return R<l?null:{left:l,top:t,width:R-l,height:B-t}}
document.addEventListener("mouseover",function(e){var el=hit(e),r=el&&box(el),f=F();if(!r){f.style.display="none";return}f.style.display="block";f.style.left=r.left+scrollX-3+"px";f.style.top=r.top+scrollY-3+"px";f.style.width=r.width+6+"px";f.style.height=r.height+6+"px"});
document.addEventListener("mouseout",function(e){if(!e.relatedTarget&&b)b.style.display="none"});
document.addEventListener("click",function(e){var el=hit(e);if(!el)return;e.preventDefault();e.stopPropagation();parent.postMessage({type:"cms-select",path:el.getAttribute("data-cms-path")},"*")},true);
})();`;
