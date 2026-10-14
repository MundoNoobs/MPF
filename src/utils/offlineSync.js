// src/utils/offlineSync.js
import dbInicial from "../../db.json";

const PC_API_URL = "http://192.168.1.119:3001";
const QUEUE_KEY = "mpf_sync_queue";
const originalFetch = window.fetch.bind(window);

// 1. Sembrar todas las colecciones de tu db.json en el celular apenas se importa el archivo
function inicializarCacheDesdeSemilla() {
  if (!dbInicial) return;
  Object.keys(dbInicial).forEach((coleccion) => {
    const key = `mpf_cache_${coleccion}`;
    const actual = localStorage.getItem(key);
    if (!actual || actual === "[]" || actual === "null") {
      localStorage.setItem(key, JSON.stringify(dbInicial[coleccion]));
    }
  });
}

const getQueue = () => JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
const saveQueue = (q) => localStorage.setItem(QUEUE_KEY, JSON.stringify(q));

// 2. Comprobar si el servidor de tu PC (puerto 3001) está activo
export async function checkPCServer() {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1200);
    const res = await originalFetch(`${PC_API_URL}/cuentas?t=${Date.now()}`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(id);
    return res.ok;
  } catch {
    return false;
  }
}

// 3. Vaciar cola de cambios pendientes hacia la PC
let sincronizando = false;
export async function sincronizarColaConPC() {
  if (sincronizando) return;
  const cola = getQueue();
  if (cola.length === 0) return;

  const online = await checkPCServer();
  if (!online) return;

  sincronizando = true;
  const restantes = [...cola];

  for (const item of cola) {
    try {
      const res = await originalFetch(`${PC_API_URL}${item.path}`, {
        method: item.method,
        headers: { "Content-Type": "application/json" },
        body: item.body ? JSON.stringify(item.body) : undefined,
      });

      if (res.ok || res.status === 404) {
        restantes.shift();
        saveQueue(restantes);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
  sincronizando = false;
}

// 4. Activar el interceptor de forma inmediata
export function activarModoOffline() {
  inicializarCacheDesdeSemilla();

  window.fetch = async (input, options = {}) => {
    const urlStr = typeof input === "string" ? input : input.url;

    // Interceptar cualquier llamada al puerto 3001
    if (!urlStr.includes(":3001")) {
      return originalFetch(input, options);
    }

    const urlObj = new URL(urlStr, PC_API_URL);
    const path = urlObj.pathname + urlObj.search;
    const segmentos = urlObj.pathname.split("/").filter(Boolean);
    const coleccion = segmentos[0]; // cuentas, gastos, ventas, productos, etc.
    const itemId = segmentos[1];
    const method = (options.method || "GET").toUpperCase();
    const cacheKey = `mpf_cache_${coleccion}`;

    // --- LECTURA (GET) ---
    if (method === "GET") {
      const online = await checkPCServer();
      if (online) {
        await sincronizarColaConPC();
        try {
          // Si no tiene query params, guardamos la colección completa en caché
          const res = await originalFetch(`${PC_API_URL}${path}`);
          if (res.ok) {
            const data = await res.clone().json();
            if (!itemId && !urlObj.search) {
              localStorage.setItem(cacheKey, JSON.stringify(data));
            }
            return res;
          }
        } catch {
          // Si falla, usa los datos locales abajo
        }
      }

      // Respuesta Offline desde la memoria del celular (o db.json de respaldo)
      let localData = JSON.parse(
        localStorage.getItem(cacheKey) || JSON.stringify(dbInicial[coleccion] || [])
      );

      // Si pide un ID específico (ej: /cuentas/1)
      if (itemId) {
        const encontrado = localData.find((x) => String(x.id) === String(itemId));
        return new Response(JSON.stringify(encontrado || {}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Si tiene filtros en la URL (ej: /mensualidades_pagos?mes=2026-08)
      urlObj.searchParams.forEach((valor, clave) => {
        localData = localData.filter((item) => String(item[clave]) === String(valor));
      });

      return new Response(JSON.stringify(localData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // --- ESCRITURA (POST, PUT, PATCH, DELETE) ---
    const bodyData = options.body ? JSON.parse(options.body) : null;
    let localData = JSON.parse(
      localStorage.getItem(cacheKey) || JSON.stringify(dbInicial[coleccion] || [])
    );
    let respuestaLocal = bodyData;

    if (method === "POST") {
      respuestaLocal = { ...bodyData, id: bodyData?.id || String(Date.now()) };
      localData.push(respuestaLocal);
    } else if (method === "PUT" || method === "PATCH") {
      localData = localData.map((item) => {
        if (String(item.id) === String(itemId)) {
          respuestaLocal =
            method === "PUT" ? { ...bodyData, id: item.id } : { ...item, ...bodyData };
          return respuestaLocal;
        }
        return item;
      });
    } else if (method === "DELETE") {
      localData = localData.filter((item) => String(item.id) !== String(itemId));
      respuestaLocal = {};
    }
    localStorage.setItem(cacheKey, JSON.stringify(localData));

    // Intentar mandar a la PC si está encendida
    const online = await checkPCServer();
    if (online) {
      await sincronizarColaConPC();
      try {
        const res = await originalFetch(`${PC_API_URL}${path}`, {
          ...options,
          method,
          headers: { "Content-Type": "application/json" },
          body: method !== "DELETE" ? JSON.stringify(respuestaLocal) : undefined,
        });
        if (res.ok) return res;
      } catch {
        // Pasa a la cola
      }
    }

    // Guardar en la cola de espera si la PC está apagada
    const cola = getQueue();
    cola.push({
      path,
      method,
      body: method !== "DELETE" ? respuestaLocal : null,
      timestamp: Date.now(),
    });
    saveQueue(cola);

    return new Response(JSON.stringify(respuestaLocal), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  // Radar cada 5 segundos
  setInterval(async () => {
    const online = await checkPCServer();
    if (online && getQueue().length > 0) {
      await sincronizarColaConPC();
    }
  }, 5000);
}

// ¡CLAVE!: Lo ejecutamos aquí mismo para que se active ANTES de que cargue App.jsx
activarModoOffline();