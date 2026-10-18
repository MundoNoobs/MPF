import { useState, useEffect, useCallback } from 'react';
import {
  descargarDb, subirDb, consultarPendiente, getLocalMeta,
  getServerUrl, setServerUrl,
} from '../services/syncService';
import { getConfiguredMac, setConfiguredMac } from '../utils/deviceInfo';
import { estilos } from './syncPanelStyles';

export default function SyncPanel() {
  const [cargando, setCargando] = useState(null); // 'bajar' | 'subir' | null
  const [mensaje, setMensaje] = useState(null); // { tipo, texto, detalles }
  const [meta, setMeta] = useState(() => getLocalMeta());
  const [pendiente, setPendiente] = useState(false);
  const [config, setConfig] = useState(false);
  const [url, setUrl] = useState(() => getServerUrl());
  const [mac, setMac] = useState(() => getConfiguredMac());
  const [conflicto, setConflicto] = useState(false);

  const revisarPendiente = useCallback(async () => {
    try {
      setPendiente(await consultarPendiente());
    } catch (e) {
      console.error('[SyncPanel] error consultando pendiente', e);
    }
  }, []);

  useEffect(() => {
    revisarPendiente();
    const id = setInterval(revisarPendiente, 30000);
    return () => clearInterval(id);
  }, [revisarPendiente]);

  const ejecutar = async (tipo, accion, textoOk) => {
    if (cargando) return;
    setCargando(tipo);
    setMensaje(null);
    setConflicto(false);
    try {
      await accion();
      setMensaje({ tipo: 'ok', texto: textoOk });
      setMeta(getLocalMeta());
      revisarPendiente();
    } catch (e) {
      console.error('[SyncPanel]', e);
      if (e.code === 'VERSION_CONFLICT') setConflicto(true);
      setMensaje({
        tipo: 'error',
        texto: e.message || 'Error inesperado',
        detalles: Array.isArray(e.details) ? e.details.slice(0, 5) : null,
      });
    } finally {
      setCargando(null);
    }
  };

  const bajar = () => ejecutar('bajar', descargarDb, 'Base de datos descargada y guardada en el dispositivo.');
  const subir = (opts) => ejecutar('subir', () => subirDb(opts), 'Base de datos del sistema actualizada correctamente.');

  const guardarConfig = () => {
    try {
      setServerUrl(url);
      setConfiguredMac(mac);
      setUrl(getServerUrl());
      setMensaje({ tipo: 'ok', texto: 'Configuración guardada.' });
      setConfig(false);
    } catch (e) {
      setMensaje({ tipo: 'error', texto: e.message });
    }
  };

  const fecha = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

  return (
    <div style={estilos.caja}>
      <div style={estilos.encabezado}>
        <h2 style={{ margin: 0, color: '#1f2937' }}>Sincronización de Base de Datos</h2>
        <button onClick={() => setConfig(!config)} style={estilos.botonConfig} title="Configurar servidor">⚙️</button>
      </div>

      {pendiente && (
        <div style={{ ...estilos.aviso, background: '#fef3c7', color: '#92400e' }}>
          📡 El sistema pidió una actualización: descarga la BD actual.
        </div>
      )}

      {config && (
        <div style={estilos.config}>
          <label style={estilos.label}>URL del servidor</label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} style={estilos.input} placeholder="http://192.168.1.10:3002" />
          <label style={estilos.label}>MAC del dispositivo (opcional)</label>
          <input value={mac} onChange={(e) => setMac(e.target.value)} style={estilos.input} placeholder="AA:BB:CC:DD:EE:FF" />
          <button onClick={guardarConfig} style={{ ...estilos.boton, background: '#3b82f6' }}>Guardar</button>
        </div>
      )}

      <div style={estilos.grid}>
        <button onClick={bajar} disabled={!!cargando} style={{ ...estilos.boton, background: '#3b82f6', opacity: cargando ? 0.6 : 1 }}>
          <div style={{ fontSize: '28px' }}>⬇️</div>
          {cargando === 'bajar' ? 'Descargando…' : 'Descargar DB Actual'}
        </button>
        <button onClick={() => subir()} disabled={!!cargando} style={{ ...estilos.boton, background: '#10b981', opacity: cargando ? 0.6 : 1 }}>
          <div style={{ fontSize: '28px' }}>⬆️</div>
          {cargando === 'subir' ? 'Enviando…' : 'Actualizar DB del Sistema'}
        </button>
      </div>

      {mensaje && (
        <div style={{ ...estilos.aviso, background: mensaje.tipo === 'ok' ? '#d1fae5' : '#fee2e2', color: mensaje.tipo === 'ok' ? '#065f46' : '#991b1b' }}>
          {mensaje.tipo === 'ok' ? '✅ ' : '⚠️ '}{mensaje.texto}
          {mensaje.detalles && (
            <ul style={{ margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px' }}>
              {mensaje.detalles.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          )}
          {conflicto && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
              <button style={estilos.botonChico} onClick={() => subir({ modo: 'merge' })}>Fusionar</button>
              <button style={{ ...estilos.botonChico, background: '#ef4444' }} onClick={() => subir({ forzar: true })}>Sobrescribir</button>
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '10px' }}>
        Servidor: {url} · Última descarga: {fecha(meta?.descargadoEn)} · Última subida: {fecha(meta?.subidoEn)}
      </div>
    </div>
  );
}
