import { CONFIG } from '../config.js';
import { AppError } from './errors.js';

/** Lee el cuerpo completo con límite de tamaño y timeout, y lo parsea como JSON. */
export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let terminado = false;

    const finalizar = (fn, valor) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(timer);
      fn(valor);
    };

    const timer = setTimeout(() => {
      finalizar(reject, new AppError(408, 'BODY_TIMEOUT', 'Tiempo agotado recibiendo el cuerpo de la petición'));
      try {
        req.destroy();
      } catch {
        /* ignorar */
      }
    }, CONFIG.bodyTimeoutMs);

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > CONFIG.maxBodyBytes) {
        finalizar(reject, new AppError(413, 'BODY_TOO_LARGE', 'El cuerpo excede el tamaño máximo permitido'));
        try {
          req.destroy();
        } catch {
          /* ignorar */
        }
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', (err) => finalizar(reject, new AppError(400, 'BODY_READ_ERROR', `Error leyendo el cuerpo: ${err.message}`)));
    req.on('aborted', () => finalizar(reject, new AppError(400, 'BODY_ABORTED', 'La conexión se cortó durante el envío')));

    req.on('end', () => {
      try {
        let texto = Buffer.concat(chunks).toString('utf8');
        if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
        if (!texto.trim()) {
          finalizar(reject, new AppError(400, 'EMPTY_BODY', 'El cuerpo de la petición está vacío'));
          return;
        }
        finalizar(resolve, JSON.parse(texto));
      } catch (err) {
        finalizar(reject, new AppError(400, 'INVALID_JSON', `JSON con sintaxis inválida: ${err.message}`));
      }
    });
  });
}
