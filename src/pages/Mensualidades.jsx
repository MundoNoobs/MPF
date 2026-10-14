import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import { aplicarCambiosSaldos } from '../utils/finanzas';

const crearFormularioVacio = () => ({
  nombre: '',
  costo: '',
  fechaProximoPago: format(new Date(), 'yyyy-MM-dd'),
  plazos: '',
  indefinido: true
});

const siguienteFechaMensual = (fecha, diaPago) => {
  const [year, month] = fecha.split('-').map(Number);
  const primerDiaSiguiente = new Date(year, month, 1, 12);
  const ultimoDia = new Date(primerDiaSiguiente.getFullYear(), primerDiaSiguiente.getMonth() + 1, 0).getDate();
  const dia = Math.min(Number(diaPago), ultimoDia);
  return `${primerDiaSiguiente.getFullYear()}-${String(primerDiaSiguiente.getMonth() + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
};

export default function Mensualidades() {
  const HOST = `http://${window.location.hostname}:3001`;
  const [reserva, setReserva] = useState(0);
  const [mensualidades, setMensualidades] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [seleccionadas, setSeleccionadas] = useState([]);
  const [formulario, setFormulario] = useState(crearFormularioVacio);
  const [editandoId, setEditandoId] = useState(null);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const formatearDinero = (monto) => Number(monto || 0).toLocaleString('es-CL');

  const cargarDatos = useCallback(async () => {
    try {
      const [resCaja, resMensualidades, resPagos] = await Promise.all([
        axios.get(`${HOST}/caja`),
        axios.get(`${HOST}/mensualidades`),
        axios.get(`${HOST}/pagosMensualidades`)
      ]);
      setReserva(Number(resCaja.data.dineroReserva || 0));
      setMensualidades(resMensualidades.data);
      setPagos(resPagos.data.sort((a, b) => new Date(b.fechaHoraPago) - new Date(a.fechaHoraPago)));
    } catch (error) {
      console.error('Error al cargar mensualidades:', error);
    }
  }, [HOST]);

  useEffect(() => {
    void Promise.resolve().then(cargarDatos);
  }, [cargarDatos]);

  const abrirNueva = () => {
    setEditandoId(null);
    setFormulario(crearFormularioVacio());
    setModalAbierto(true);
  };

  const prepararEdicion = (mensualidad) => {
    setEditandoId(mensualidad.id);
    setFormulario({
      nombre: mensualidad.nombre,
      costo: String(mensualidad.costo),
      fechaProximoPago: mensualidad.fechaProximoPago,
      plazos: mensualidad.indefinido ? '' : String(mensualidad.plazosTotal || ''),
      indefinido: Boolean(mensualidad.indefinido)
    });
    setModalAbierto(true);
  };

  const guardarMensualidad = async (event) => {
    event.preventDefault();
    const costo = Number(formulario.costo);
    const plazosTotal = formulario.indefinido || !formulario.plazos ? null : Number(formulario.plazos);
    if (!formulario.nombre.trim() || !Number.isInteger(costo) || costo < 1) {
      return alert('Ingresa un nombre y un costo entero mayor que cero.');
    }
    if (!formulario.fechaProximoPago) return alert('Selecciona la fecha del próximo pago.');
    if (plazosTotal !== null && (!Number.isInteger(plazosTotal) || plazosTotal < 1)) {
      return alert('Los plazos deben ser un número entero mayor que cero.');
    }

    const diaPago = new Date(`${formulario.fechaProximoPago}T12:00:00`).getDate();
    const registro = {
      nombre: formulario.nombre.trim(),
      costo,
      fechaProximoPago: formulario.fechaProximoPago,
      diaPago,
      plazosTotal,
      plazosPagados: editandoId ? Number(mensualidades.find(m => m.id === editandoId)?.plazosPagados || 0) : 0,
      indefinido: plazosTotal === null,
      activa: true
    };

    try {
      if (editandoId) {
        const anterior = mensualidades.find(m => m.id === editandoId);
        registro.plazosPagados = Number(anterior?.plazosPagados || 0);
        await axios.patch(`${HOST}/mensualidades/${editandoId}`, registro);
      } else {
        await axios.post(`${HOST}/mensualidades`, registro);
      }
      setModalAbierto(false);
      setFormulario(crearFormularioVacio());
      setEditandoId(null);
      cargarDatos();
    } catch (error) {
      console.error('Error al guardar mensualidad:', error);
    }
  };

  const eliminarMensualidad = async (mensualidad) => {
    if (!window.confirm(`¿Eliminar la mensualidad “${mensualidad.nombre}”? El historial de pagos se conservará.`)) return;
    try {
      await axios.delete(`${HOST}/mensualidades/${mensualidad.id}`);
      setSeleccionadas(ids => ids.filter(id => id !== mensualidad.id));
      cargarDatos();
    } catch (error) {
      console.error('Error al eliminar mensualidad:', error);
    }
  };

  const mensualidadFinalizada = (mensualidad) => (
    !mensualidad.indefinido && Number(mensualidad.plazosPagados || 0) >= Number(mensualidad.plazosTotal || 0)
  );

  const mensualidadesSeleccionadas = mensualidades.filter(
    mensualidad => seleccionadas.includes(mensualidad.id) && !mensualidadFinalizada(mensualidad)
  );
  const totalSeleccionado = mensualidadesSeleccionadas.reduce(
    (suma, mensualidad) => suma + Number(mensualidad.costo), 0
  );
  const totalMensualActivo = mensualidades
    .filter(mensualidad => !mensualidadFinalizada(mensualidad))
    .reduce((suma, mensualidad) => suma + Number(mensualidad.costo), 0);

  const alternarSeleccion = (id) => {
    setSeleccionadas(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]);
  };

  const pagarSeleccionadas = async () => {
    const pendientes = mensualidades.filter(m => seleccionadas.includes(m.id) && !mensualidadFinalizada(m));
    if (pendientes.length === 0) return alert('Selecciona al menos una mensualidad pendiente.');

    const total = pendientes.reduce((suma, mensualidad) => suma + Number(mensualidad.costo), 0);
    const hora = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
    const actualizaciones = [];
    const movimientos = [];
    const pagosCreados = [];

    setGuardando(true);
    try {
      const resCaja = await axios.get(`${HOST}/caja`);
      const reservaActual = Number(resCaja.data.dineroReserva || 0);
      if (reservaActual < total) {
        alert(`La Reserva tiene $${formatearDinero(reservaActual)} y se necesitan $${formatearDinero(total)}.`);
        return;
      }

      for (const mensualidad of pendientes) {
        const plazosPagados = Number(mensualidad.plazosPagados || 0) + 1;
        const finalizada = !mensualidad.indefinido && plazosPagados >= Number(mensualidad.plazosTotal);
        const fechaProgramada = mensualidad.fechaProximoPago;
        const fechaSiguiente = siguienteFechaMensual(fechaProgramada, mensualidad.diaPago || Number(fechaProgramada.slice(-2)));
        const camposAnteriores = {
          plazosPagados: Number(mensualidad.plazosPagados || 0),
          fechaProximoPago: mensualidad.fechaProximoPago,
          activa: mensualidad.activa !== false
        };
        const camposNuevos = {
          plazosPagados,
          fechaProximoPago: finalizada ? mensualidad.fechaProximoPago : fechaSiguiente,
          activa: !finalizada
        };

        await axios.patch(`${HOST}/mensualidades/${mensualidad.id}`, camposNuevos);
        actualizaciones.push({ id: mensualidad.id, camposAnteriores });
        await aplicarCambiosSaldos(HOST, { dineroReserva: -Number(mensualidad.costo) }, `Mensualidad - ${mensualidad.nombre}`, hora);
        movimientos.push(Number(mensualidad.costo));
        const respuestaPago = await axios.post(`${HOST}/pagosMensualidades`, {
          mensualidadId: mensualidad.id,
          nombreMensualidad: mensualidad.nombre,
          monto: Number(mensualidad.costo),
          fechaProgramada,
          fechaHoraPago: hora,
          plazoPagado: plazosPagados,
          plazosTotal: mensualidad.indefinido ? null : Number(mensualidad.plazosTotal)
        });
        pagosCreados.push(respuestaPago.data.id);
      }

      setSeleccionadas([]);
      cargarDatos();
    } catch (error) {
      for (const pagoId of pagosCreados) await axios.delete(`${HOST}/pagosMensualidades/${pagoId}`);
      for (const mensualidad of actualizaciones.reverse()) {
        await axios.patch(`${HOST}/mensualidades/${mensualidad.id}`, mensualidad.camposAnteriores);
      }
      for (const monto of movimientos.reverse()) {
        await aplicarCambiosSaldos(HOST, { dineroReserva: monto }, 'Reversión de pago mensual incompleto', hora);
      }
      console.error('Error al pagar mensualidades:', error);
      alert('No se pudieron completar todos los pagos; se revirtieron los cambios realizados.');
    } finally {
      setGuardando(false);
    }
  };

  const pagosPorMensualidad = pagos.reduce((resultado, pago) => {
    if (!resultado[pago.mensualidadId]) resultado[pago.mensualidadId] = [];
    resultado[pago.mensualidadId].push(pago);
    return resultado;
  }, {});

  return (
    <div style={estilos.contenedor}>
      <header style={estilos.encabezado}>
        <div>
          <h1 style={{margin: 0}}>Mensualidades</h1>
          <span>Saldo Reserva</span>
        </div>
        <strong style={estilos.reserva}>${formatearDinero(reserva)}</strong>
      </header>

      <div style={estilos.barraAcciones}>
        <button onClick={abrirNueva} style={estilos.botonPrimario}>+ Añadir mensualidad</button>
        <button onClick={pagarSeleccionadas} disabled={guardando || seleccionadas.length === 0} style={estilos.botonPagar}>
          {guardando ? 'Procesando...' : 'Pagar seleccionadas desde Reserva'}
        </button>
        {seleccionadas.length > 0 && (
          <div style={{...estilos.previsualizacion, color: reserva < totalSeleccionado ? '#b91c1c' : '#065f46'}}>
            Por pagar: <strong>${formatearDinero(totalSeleccionado)}</strong>
            <span> · Reserva después: <strong>${formatearDinero(reserva - totalSeleccionado)}</strong></span>
          </div>
        )}
      </div>

      <div style={estilos.tablaContenedor}>
        <table style={estilos.tabla}>
          <thead>
            <tr>
              <th>Seleccionar</th>
              <th>Mensualidad</th>
              <th>Costo</th>
              <th>Próximo pago</th>
              <th>Plazos restantes</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {mensualidades.length === 0 ? (
              <tr><td colSpan="7" style={estilos.vacio}>No hay mensualidades registradas.</td></tr>
            ) : mensualidades.map(mensualidad => {
              const finalizada = mensualidadFinalizada(mensualidad);
              const historial = pagosPorMensualidad[mensualidad.id] || [];
              const ultimoPago = historial[0];
              const plazosRestantes = mensualidad.indefinido
                ? 'Indefinido'
                : Math.max(0, Number(mensualidad.plazosTotal) - Number(mensualidad.plazosPagados || 0));

              return (
                <tr key={mensualidad.id}>
                  <td style={{textAlign: 'center'}}>
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${mensualidad.nombre} para pagar`}
                      checked={seleccionadas.includes(mensualidad.id)}
                      disabled={finalizada}
                      onChange={() => alternarSeleccion(mensualidad.id)}
                    />
                  </td>
                  <td><strong>{mensualidad.nombre}</strong></td>
                  <td>${formatearDinero(mensualidad.costo)}</td>
                  <td>{mensualidad.fechaProximoPago}</td>
                  <td>{plazosRestantes}</td>
                  <td>
                    <span style={{color: finalizada ? '#6b7280' : ultimoPago ? '#047857' : '#b45309', fontWeight: 'bold'}}>
                      {finalizada ? 'Finalizada' : ultimoPago ? `Último pago: ${ultimoPago.fechaHoraPago.slice(0, 10)}` : 'Pendiente de primer pago'}
                    </span>
                  </td>
                  <td style={estilos.acciones}>
                    <button onClick={() => prepararEdicion(mensualidad)} style={estilos.botonSecundario}>Editar</button>
                    <button onClick={() => eliminarMensualidad(mensualidad)} style={estilos.botonEliminar}>Eliminar</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={estilos.filaTotal}>
              <td colSpan="2"><strong>Total mensual activo</strong></td>
              <td><strong>${formatearDinero(totalMensualActivo)}</strong></td>
              <td colSpan="4"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <section style={estilos.historial}>
        <h2>Historial de pagos</h2>
        {pagos.length === 0 ? <p>No hay pagos registrados.</p> : (
          <div style={estilos.listaHistorial}>
            {pagos.map(pago => (
              <div key={pago.id} style={estilos.itemHistorial}>
                <div>
                  <strong>{pago.nombreMensualidad}</strong>
                  <div style={estilos.detalle}>{pago.fechaHoraPago} · Plazo {pago.plazoPagado}{pago.plazosTotal ? ` de ${pago.plazosTotal}` : ''}</div>
                  <div style={estilos.detalle}>Programado para {pago.fechaProgramada}</div>
                </div>
                <strong>-${formatearDinero(pago.monto)}</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      {modalAbierto && (
        <div style={estilos.fondoModal}>
          <form onSubmit={guardarMensualidad} style={estilos.modal}>
            <h2>{editandoId ? 'Editar mensualidad' : 'Nueva mensualidad'}</h2>
            <label>Nombre<input required value={formulario.nombre} onChange={e => setFormulario({...formulario, nombre: e.target.value})} style={estilos.input} /></label>
            <label>Costo por mes<input required type="number" min="1" step="1" value={formulario.costo} onChange={e => setFormulario({...formulario, costo: e.target.value})} style={estilos.input} /></label>
            <label>Fecha del próximo pago<input required type="date" value={formulario.fechaProximoPago} onChange={e => setFormulario({...formulario, fechaProximoPago: e.target.value})} style={estilos.input} /></label>
            <label style={estilos.checkPlazos}>
              <input type="checkbox" checked={formulario.indefinido} onChange={e => setFormulario({...formulario, indefinido: e.target.checked})} />
              Indefinido
            </label>
            {!formulario.indefinido && (
              <label>Plazos totales (opcional)<input type="number" min="1" step="1" value={formulario.plazos} onChange={e => setFormulario({...formulario, plazos: e.target.value})} style={estilos.input} /></label>
            )}
            <div style={estilos.botonesModal}>
              <button type="submit" style={estilos.botonPrimario}>{editandoId ? 'Guardar cambios' : 'Crear'}</button>
              <button type="button" onClick={() => setModalAbierto(false)} style={estilos.botonSecundario}>Cancelar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const estilos = {
  contenedor: {maxWidth: '1100px', margin: '0 auto', paddingBottom: '40px'},
  encabezado: {display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', background: '#1f2937', color: 'white', padding: '22px', borderRadius: '8px', marginBottom: '16px'},
  reserva: {fontSize: '30px', color: '#34d399'},
  barraAcciones: {display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px'},
  previsualizacion: {alignSelf: 'center', padding: '8px 12px', background: '#f3f4f6', borderRadius: '5px'},
  tablaContenedor: {overflowX: 'auto', background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px'},
  tabla: {width: '100%', borderCollapse: 'collapse', textAlign: 'left'},
  vacio: {textAlign: 'center', padding: '22px', color: '#6b7280'},
  filaTotal: {background: '#f3f4f6', borderTop: '2px solid #d1d5db'},
  acciones: {display: 'flex', gap: '6px', flexWrap: 'wrap'},
  historial: {marginTop: '28px'},
  listaHistorial: {display: 'flex', flexDirection: 'column'},
  itemHistorial: {display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '12px 4px', borderBottom: '1px solid #e5e7eb'},
  detalle: {fontSize: '12px', color: '#6b7280', marginTop: '3px'},
  botonPrimario: {padding: '10px 14px', border: 0, borderRadius: '5px', background: '#10b981', color: 'white', fontWeight: 'bold', cursor: 'pointer'},
  botonPagar: {padding: '10px 14px', border: 0, borderRadius: '5px', background: '#2563eb', color: 'white', fontWeight: 'bold', cursor: 'pointer'},
  botonSecundario: {padding: '7px 10px', border: '1px solid #9ca3af', borderRadius: '5px', background: 'white', cursor: 'pointer'},
  botonEliminar: {padding: '7px 10px', border: 0, borderRadius: '5px', background: '#ef4444', color: 'white', cursor: 'pointer'},
  input: {display: 'block', width: '100%', boxSizing: 'border-box', padding: '9px', border: '1px solid #d1d5db', borderRadius: '5px', marginTop: '5px'},
  checkPlazos: {display: 'flex', alignItems: 'center', gap: '8px'},
  botonesModal: {display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px'},
  fondoModal: {position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.55)', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '16px'},
  modal: {display: 'flex', flexDirection: 'column', gap: '12px', background: 'white', width: '100%', maxWidth: '460px', maxHeight: '90vh', overflowY: 'auto', padding: '22px', borderRadius: '8px'}
};
