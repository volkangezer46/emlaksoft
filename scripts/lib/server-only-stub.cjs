// CLI betikleri (tsx) için: Next.js'in sağladığı `server-only` paketi node_modules'ta yok; sunucu modüllerini betikten
// içe aktarırken boş modüle çözülür (yalnız istemci paketine sızmayı önleyen bir işarettir, çalışma zamanı davranışı yok).
const Module = require("node:module");
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return require.resolve("./empty.cjs");
  return orig.call(this, request, ...rest);
};
