const $ = (id) => document.getElementById(id);
let fallos = 0;

function mostrar(msg, tipo) {
  const el = $('estado');
  el.textContent = msg;
  el.className = tipo;
  el.style.display = 'block';
  clearTimeout(mostrar.t);
  if (tipo === 'ok') mostrar.t = setTimeout(() => (el.style.display = 'none'), 5000);
}

async function api(ruta, opciones = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(ruta, { ...opciones, signal: ctrl.signal });
    let datos = null;
    try { datos = await res.json(); } catch { /* respuesta sin JSON */ }
    if (!res.ok) throw new Error((datos && datos.message) || 'Error HTTP ' + res.status);
    return datos;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Tiempo de espera agotado');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function celda(texto) {
  const td = document.createElement('td');
  td.textContent = texto;
  return td;
}

function fmt(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleString() : '—';
}

function pintar(lista) {
  const cuerpo = $('cuerpo');
  cuerpo.replaceChildren();
  if (!lista.length) {
    const tr = document.createElement('tr');
    const td = celda('Aún no hay dispositivos registrados.');
    td.colSpan = 9;
    tr.appendChild(td);
    cuerpo.appendChild(tr);
    return;
  }
  for (const d of lista) {
    const tr = document.createElement('tr');
    const est = document.createElement('td');
    const p = document.createElement('span');
    p.className = 'punto' + (d.online ? ' on' : '');
    est.append(p, d.online ? 'En línea' : 'Inactivo');
    tr.appendChild(est);
    tr.appendChild(celda(d.ip + (d.ipLocal && d.ipLocal !== d.ip ? ' (' + d.ipLocal + ')' : '')));
    tr.appendChild(celda(d.mac));
    tr.appendChild(celda(d.nombre || '—'));
    tr.appendChild(celda(fmt(d.ultimoContacto)));
    tr.appendChild(celda(d.ultimaSync ? d.ultimaSync.tipo + ' · ' + fmt(d.ultimaSync.fecha) : '—'));
    tr.appendChild(celda(String(d.contactos)));
    const pend = document.createElement('td');
    if (d.pendienteActualizacion) {
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = 'Pendiente';
      pend.appendChild(c);
    } else {
      pend.textContent = '—';
    }
    tr.appendChild(pend);
    const acc = document.createElement('td');
    const b = document.createElement('button');
    b.className = 'rojo';
    b.textContent = '✕';
    b.title = 'Olvidar dispositivo';
    b.onclick = () => olvidar(d.key);
    acc.appendChild(b);
    tr.appendChild(acc);
    cuerpo.appendChild(tr);
  }
}

async function cargar() {
  try {
    const r = await api('/api/devices');
    pintar(r.dispositivos || []);
    $('meta').textContent =
      r.total + ' dispositivo(s) · versión BD ' + (r.version ? r.version.slice(0, 8) : 'n/d') + ' · ' + new Date().toLocaleTimeString();
    if (fallos > 0) mostrar('Conexión restablecida', 'ok');
    fallos = 0;
  } catch (e) {
    fallos++;
    mostrar('Sin conexión con el servidor (' + e.message + '). Reintentando…', 'error');
  }
}

async function olvidar(key) {
  if (!confirm('¿Olvidar este dispositivo?')) return;
  try {
    await api('/api/devices/' + encodeURIComponent(key), { method: 'DELETE' });
    cargar();
  } catch (e) {
    mostrar('No se pudo eliminar: ' + e.message, 'error');
  }
}

$('btnBroadcast').onclick = async () => {
  const btn = $('btnBroadcast');
  if (!confirm('¿Notificar la última versión de db.json a todos los dispositivos registrados?')) return;
  btn.disabled = true;
  try {
    const r = await api('/api/broadcast', { method: 'POST' });
    mostrar(r.notificados + ' dispositivo(s) notificados. Descargarán la BD en su próximo contacto.', 'ok');
    cargar();
  } catch (e) {
    mostrar('Falló la sincronización masiva: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
};
$('btnRefrescar').onclick = cargar;

// Tiempo real: sondeo con retroceso si hay fallos
(function ciclo() {
  setTimeout(async () => {
    await cargar();
    ciclo();
  }, Math.min(3000 * (1 + fallos), 30000));
})();
cargar();
