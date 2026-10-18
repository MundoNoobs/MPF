// Esquema compartido (servidor + app) para validar la integridad de db.json.
// JS puro y sin dependencias para poder importarlo desde Node y desde Vite.

export const REQUIRED_COLLECTIONS = ['productos', 'clientes', 'ventas', 'gastos', 'movimientos'];
export const OPTIONAL_COLLECTIONS = ['gastosRecurrentes', 'mensualidades', 'pagosMensualidades'];
export const CAJA_FIELDS = ['dineroTotal', 'dineroCompra', 'dineroReserva'];
const MAX_ERRORS = 20;

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const esIdValido = (v) => (typeof v === 'string' && v.trim() !== '') || (typeof v === 'number' && Number.isFinite(v));

/**
 * Valida la estructura de la base de datos.
 * @param {unknown} data
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateDb(data) {
  const errors = [];
  const push = (msg) => {
    if (errors.length < MAX_ERRORS) errors.push(msg);
  };

  try {
    if (!esObjeto(data)) {
      return { valid: false, errors: ['La raíz del JSON debe ser un objeto'] };
    }

    if (!esObjeto(data.caja)) {
      push('"caja" debe ser un objeto');
    } else {
      for (const campo of CAJA_FIELDS) {
        if (typeof data.caja[campo] !== 'number' || !Number.isFinite(data.caja[campo])) {
          push(`"caja.${campo}" debe ser un número`);
        }
      }
    }

    const colecciones = [
      ...REQUIRED_COLLECTIONS.map((n) => [n, true]),
      ...OPTIONAL_COLLECTIONS.map((n) => [n, false]),
    ];

    for (const [nombre, requerida] of colecciones) {
      const lista = data[nombre];
      if (lista === undefined) {
        if (requerida) push(`Falta la colección obligatoria "${nombre}"`);
        continue;
      }
      if (!Array.isArray(lista)) {
        push(`"${nombre}" debe ser un arreglo`);
        continue;
      }
      const ids = new Set();
      lista.forEach((item, i) => {
        if (!esObjeto(item)) {
          push(`${nombre}[${i}] debe ser un objeto`);
          return;
        }
        if (!esIdValido(item.id)) {
          push(`${nombre}[${i}] no tiene un "id" válido`);
          return;
        }
        const clave = String(item.id);
        if (ids.has(clave)) push(`${nombre}[${i}] tiene id duplicado: ${clave}`);
        ids.add(clave);
      });
    }

    if (Array.isArray(data.productos)) {
      data.productos.forEach((p, i) => {
        if (esObjeto(p)) {
          if (typeof p.nombre !== 'string') push(`productos[${i}].nombre debe ser texto`);
          if (typeof p.precio !== 'number') push(`productos[${i}].precio debe ser número`);
          if (typeof p.stock !== 'number') push(`productos[${i}].stock debe ser número`);
        }
      });
    }
  } catch (err) {
    return { valid: false, errors: [`Error inesperado validando: ${err?.message || err}`] };
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Fusiona dos bases de datos: las colecciones se combinan por id (gana la entrante).
 */
export function mergeDb(actual, entrante) {
  const resultado = { ...actual, ...entrante };
  resultado.caja = { ...(actual?.caja || {}), ...(entrante?.caja || {}) };
  for (const nombre of [...REQUIRED_COLLECTIONS, ...OPTIONAL_COLLECTIONS]) {
    const a = Array.isArray(actual?.[nombre]) ? actual[nombre] : [];
    const b = Array.isArray(entrante?.[nombre]) ? entrante[nombre] : [];
    if (!a.length && !b.length && actual?.[nombre] === undefined && entrante?.[nombre] === undefined) continue;
    const mapa = new Map();
    for (const item of a) mapa.set(String(item.id), item);
    for (const item of b) mapa.set(String(item.id), item);
    resultado[nombre] = [...mapa.values()];
  }
  return resultado;
}
