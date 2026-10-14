import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import { aplicarCambiosSaldos, obtenerSaldos } from '../utils/finanzas';

export default function Resumen() {
  const HOST = `http://${window.location.hostname}:3001`;

  // --- ESTADOS PRINCIPALES ---
  const [caja, setCaja] = useState(0);
  const [dineroCompra, setDineroCompra] = useState(0);
  const [dineroReserva, setDineroReserva] = useState(0);
  const [ajusteSaldo, setAjusteSaldo] = useState({ campo: 'dineroTotal', operacion: 'sumar', monto: '' });
  const [transferencia, setTransferencia] = useState({ origen: 'dineroTotal', destino: 'dineroCompra', monto: '' });
  
  const [movimientos, setMovimientos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [ventas, setVentas] = useState([]);
  const [gastosRecurrentes, setGastosRecurrentes] = useState([]);

  // --- ESTADOS GESTIÓN CLIENTES ---
  const [modalClientes, setModalClientes] = useState(false);
  const [formCliente, setFormCliente] = useState({ nombre: '', numero: '', descripcion: '' });
  const [editandoClienteId, setEditandoClienteId] = useState(null);
  
  const [clienteHistorial, setClienteHistorial] = useState(null);

  // --- ESTADOS DEUDORES (PAGOS) ---
  const [pagoAbono, setPagoAbono] = useState({});
  const [pagoSeleccion, setPagoSeleccion] = useState({});

  // 0. FUNCIÓN PARA FORMATEAR DINERO
  const formatearDinero = (monto) => {
    return Number(monto).toLocaleString('es-CL');
  };

  const cargarDatos = useCallback(async () => {
    try {
      const resC = await axios.get(`${HOST}/caja`);
      const saldosActuales = obtenerSaldos(resC.data);
      setCaja(saldosActuales.total);
      setDineroCompra(saldosActuales.compra);
      setDineroReserva(saldosActuales.reserva);
      
      const resM = await axios.get(`${HOST}/movimientos`);
      
      let saldoAcumulado = saldosActuales.total;
      const movimientosConSaldo = resM.data.reverse().map(mov => {
        const saldoEnEseMomento = saldoAcumulado;
        saldoAcumulado -= Number(mov.monto || 0);
        return { ...mov, saldo: saldoEnEseMomento };
      });
      
      setMovimientos(movimientosConSaldo);
      
      const resCli = await axios.get(`${HOST}/clientes`);
      setClientes(resCli.data);
      
      const resVen = await axios.get(`${HOST}/ventas`);
      setVentas(resVen.data);

      const resRec = await axios.get(`${HOST}/gastosRecurrentes`);
      setGastosRecurrentes(resRec.data);
    } catch (error) {
      console.error("Error al cargar datos:", error);
    }
  }, [HOST]);

  // 1. Cargar Datos Globales
  useEffect(() => {
    void Promise.resolve().then(cargarDatos);
  }, [cargarDatos]);

  // --- 2. LÓGICA DE SALDOS Y MOVIMIENTOS ---
  const guardarAjusteSaldo = async () => {
    const monto = Number(ajusteSaldo.monto);
    if (!Number.isFinite(monto) || monto <= 0) return alert('Ingresa un monto válido.');
    const signo = ajusteSaldo.operacion === 'sumar' ? 1 : -1;

    try {
      await aplicarCambiosSaldos(HOST, { [ajusteSaldo.campo]: signo * monto }, `${ajusteSaldo.operacion === 'sumar' ? 'Ingreso' : 'Retiro'} manual`, format(new Date(), 'yyyy-MM-dd HH:mm:ss'));
      setAjusteSaldo({ ...ajusteSaldo, monto: '' });
      cargarDatos();
    } catch (error) {
      console.error('Error al ajustar saldo:', error);
    }
  };

  const transferirSaldo = async () => {
    const monto = Number(transferencia.monto);
    if (!Number.isFinite(monto) || monto <= 0) return alert('Ingresa un monto válido.');
    if (transferencia.origen === transferencia.destino) return alert('Elige dos saldos diferentes.');

    try {
      await aplicarCambiosSaldos(HOST, {
        [transferencia.origen]: -monto,
        [transferencia.destino]: monto
      }, 'Transferencia entre saldos', format(new Date(), 'yyyy-MM-dd HH:mm:ss'));
      setTransferencia({ ...transferencia, monto: '' });
      cargarDatos();
    } catch (error) {
      console.error('Error al transferir saldo:', error);
    }
  };

  // --- 3. LÓGICA DE CLIENTES (CRUD) ---
  const guardarCliente = async (e) => {
    e.preventDefault();
    if (editandoClienteId) {
      await axios.put(`${HOST}/clientes/${editandoClienteId}`, formCliente);
      setEditandoClienteId(null);
    } else {
      await axios.post(`${HOST}/clientes`, formCliente);
    }
    setFormCliente({ nombre: '', numero: '', descripcion: '' });
    cargarDatos();
  };

  const prepararEdicionCliente = (cli) => {
    setFormCliente({ nombre: cli.nombre, numero: cli.numero, descripcion: cli.descripcion });
    setEditandoClienteId(cli.id);
  };

  const eliminarCliente = async (id) => {
    if (window.confirm("¿Seguro que deseas eliminar este cliente?")) {
      await axios.delete(`${HOST}/clientes/${id}`);
      cargarDatos();
    }
  };

  // --- 4. LÓGICA DE DEUDORES Y PAGOS ---
  const deudores = clientes.map(cliente => {
    const ventasPendientes = ventas.filter(v => v.clienteNombre === cliente.nombre && !v.pagado);
    const deuda = ventasPendientes.reduce((suma, v) => suma + (v.total - (v.abono || 0)), 0);
    const envasesAdeudados = ventas
      .filter(v => v.clienteNombre === cliente.nombre && v.entregoEnvase === false)
      .reduce((suma, venta) => suma + Number(venta.envasesAdeudados ?? 1), 0);
    return { ...cliente, deuda, envasesAdeudados, ventasPendientes };
  }).filter(c => c.deuda > 0 || c.envasesAdeudados > 0);

  const calcularCostoVenta = (venta) => {
    const packsSeleccionados = { ...(venta.packsSeleccionados || {}) };
    let costoTotal = 0;

    for (const item of venta.productos || []) {
      const packs = gastosRecurrentes.filter(pack => String(pack.productoId) === String(item.productoId));
      if (packs.length === 0) continue;

      const packGuardado = packsSeleccionados[item.productoId];
      let pack = packGuardado && typeof packGuardado === 'object'
        ? packGuardado
        : packs.find(opcion => String(opcion.id) === String(packGuardado));
      if (!pack && packs.length === 1) {
        pack = packs[0];
      } else if (!pack) {
        const opciones = packs.map((opcion, index) => `${index + 1}. ${opcion.nombre} ($${opcion.precio} / ${opcion.unidadesPorPack} uds.)`).join('\n');
        const seleccion = window.prompt(`Elige el pack para ${item.nombre}:\n${opciones}`, '1');
        const indice = Number(seleccion) - 1;
        if (seleccion === null || !Number.isInteger(indice) || indice < 0 || indice >= packs.length) return null;
        pack = packs[indice];
      }

      packsSeleccionados[item.productoId] = {
        id: pack.id,
        nombre: pack.nombre,
        precio: Number(pack.precio),
        unidadesPorPack: Number(pack.unidadesPorPack || 1)
      };
      costoTotal += Number(item.cantidad) * Number(pack.precio) / Number(pack.unidadesPorPack || 1);
    }

    return { costoTotal, packsSeleccionados };
  };

  const registrarCobro = async (venta, montoCobrado, clienteNombre, nuevoAbono, costoPrecalculado) => {
    const costoVenta = costoPrecalculado || calcularCostoVenta(venta);
    if (!costoVenta) return false;

    const costoCompraAsignado = Number(venta.costoCompraAsignado || 0);
    const compra = Math.min(montoCobrado, Math.max(0, costoVenta.costoTotal - costoCompraAsignado));
    const reserva = montoCobrado - compra;
    const hora = format(new Date(), 'yyyy-MM-dd HH:mm:ss');

    await aplicarCambiosSaldos(HOST, {
      dineroCompra: compra,
      dineroReserva: reserva
    }, `Cobro de venta - ${clienteNombre}`, hora);

    const cambiosVenta = {
      abono: nuevoAbono,
      pagado: nuevoAbono >= Number(venta.total),
      packsSeleccionados: costoVenta.packsSeleccionados,
      costoReposicionTotal: costoVenta.costoTotal,
      costoCompraAsignado: costoCompraAsignado + compra,
      dineroReservaAsignado: Number(venta.dineroReservaAsignado || 0) + reserva
    };
    if (cambiosVenta.pagado) {
      cambiosVenta.abonoAntesDelPago = Number(venta.abono || 0);
      cambiosVenta.compraAntesDelPago = costoCompraAsignado;
      cambiosVenta.reservaAntesDelPago = Number(venta.dineroReservaAsignado || 0);
    }

    try {
      await axios.patch(`${HOST}/ventas/${venta.id}`, cambiosVenta);
    } catch (error) {
      await aplicarCambiosSaldos(HOST, {
        dineroCompra: -compra,
        dineroReserva: -reserva
      }, `Reversión de cobro incompleto - ${clienteNombre}`, hora);
      throw error;
    }

    return true;
  };

  const pagarCompraEspecifica = async (clienteNombre, ventaId) => {
    if (!ventaId) return alert("Selecciona una compra primero.");
    
    const venta = ventas.find(v => String(v.id) === String(ventaId));
    const montoAPagar = venta.total - (venta.abono || 0);

    try {
      const registrado = await registrarCobro(venta, montoAPagar, clienteNombre, Number(venta.total));
      if (!registrado) return;

      alert(`¡Compra cancelada! Se asignaron $${formatearDinero(montoAPagar)} entre Compra y Reserva.`);
      setPagoSeleccion({ ...pagoSeleccion, [clienteNombre]: '' });
      cargarDatos();
    } catch (error) {
      console.error(error);
    }
  };

  const abonarCantidad = async (clienteNombre, ventasPendientes) => {
    const montoString = pagoAbono[clienteNombre];
    let monto = Number(montoString);
    if (!monto || monto <= 0) return alert("Ingresa un monto válido mayor a 0.");

    const montoOriginal = monto;
    const ventasOrdenadas = [...ventasPendientes].sort((a, b) => new Date(a.fechaHoraExacta) - new Date(b.fechaHoraExacta));
    const deudaTotal = ventasOrdenadas.reduce((total, venta) => total + Number(venta.total) - Number(venta.abono || 0), 0);
    if (monto > deudaTotal) return alert(`El abono supera la deuda pendiente de $${formatearDinero(deudaTotal)}.`);
    const cobrosPreparados = [];
    for (const venta of ventasOrdenadas) {
      if (monto <= 0) break;
      const montoVenta = Math.min(monto, Number(venta.total) - Number(venta.abono || 0));
      const costoVenta = calcularCostoVenta(venta);
      if (!costoVenta) return;
      cobrosPreparados.push({ venta, montoVenta, costoVenta });
      monto -= montoVenta;
    }

    try {
      for (const { venta, montoVenta, costoVenta } of cobrosPreparados) {
        const registrado = await registrarCobro(venta, montoVenta, clienteNombre, Number(venta.abono || 0) + montoVenta, costoVenta);
        if (!registrado) return;
      }

      alert(`¡Abono de $${formatearDinero(montoOriginal)} registrado entre Compra y Reserva!`);
      setPagoAbono({ ...pagoAbono, [clienteNombre]: '' }); 
      cargarDatos();
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div style={estilos.contenedor}>
      
      {/* 1. SALDOS */}
      <div style={estilos.panelCaja}>
        <div>
          <h2 style={{margin: 0, color: 'white'}}>Saldos</h2>
          <div style={{display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '12px'}}>
            {[
              { campo: 'dineroTotal', titulo: 'Total', monto: caja },
              { campo: 'dineroCompra', titulo: 'Compra', monto: dineroCompra },
              { campo: 'dineroReserva', titulo: 'Reserva', monto: dineroReserva }
            ].map(saldo => (
              <div key={saldo.campo} style={estilos.tarjetaSaldo}>
                <strong>{saldo.titulo}</strong>
                <div style={{fontSize: '24px', fontWeight: 'bold', marginTop: '6px'}}>${formatearDinero(saldo.monto)}</div>
              </div>
            ))}
          </div>

          <div style={{display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '14px', alignItems: 'center'}}>
            <select value={ajusteSaldo.campo} onChange={e => setAjusteSaldo({...ajusteSaldo, campo: e.target.value})} style={estilos.input}>
              <option value="dineroTotal">Total</option>
              <option value="dineroCompra">Compra</option>
              <option value="dineroReserva">Reserva</option>
            </select>
            <select value={ajusteSaldo.operacion} onChange={e => setAjusteSaldo({...ajusteSaldo, operacion: e.target.value})} style={estilos.input}>
              <option value="sumar">Sumar</option>
              <option value="restar">Restar</option>
            </select>
            <input type="number" min="0.01" value={ajusteSaldo.monto} onChange={e => setAjusteSaldo({...ajusteSaldo, monto: e.target.value})} placeholder="Monto" style={{...estilos.input, width: '130px'}} />
            <button onClick={guardarAjusteSaldo} style={estilos.btnVerde}>Aplicar</button>
          </div>

          <div style={{display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px', alignItems: 'center'}}>
            <select value={transferencia.origen} onChange={e => setTransferencia({...transferencia, origen: e.target.value})} style={estilos.input}>
              <option value="dineroTotal">Desde Total</option>
              <option value="dineroCompra">Desde Compra</option>
              <option value="dineroReserva">Desde Reserva</option>
            </select>
            <select value={transferencia.destino} onChange={e => setTransferencia({...transferencia, destino: e.target.value})} style={estilos.input}>
              <option value="dineroTotal">Hacia Total</option>
              <option value="dineroCompra">Hacia Compra</option>
              <option value="dineroReserva">Hacia Reserva</option>
            </select>
            <input type="number" min="0.01" value={transferencia.monto} onChange={e => setTransferencia({...transferencia, monto: e.target.value})} placeholder="Monto a mover" style={{...estilos.input, width: '130px'}} />
            <button onClick={transferirSaldo} style={estilos.btnAzul}>Transferir</button>
          </div>
        </div>

        <button onClick={() => setModalClientes(true)} style={estilos.btnClientes}>
          👥 Gestionar Clientes
        </button>
      </div>

      {/* 2. CUENTAS POR COBRAR (DEUDORES) */}
      <h2 style={{marginTop: '30px'}}>Cuentas por Cobrar (Deudores)</h2>
      <div style={estilos.tablaContenedor}>
        <table style={estilos.tabla}>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Deuda ($)</th>
              <th>Envases adeudados</th>
              <th>Pagar una Compra Específica</th>
              <th>O Abonar Cantidad (Auto-descuento)</th>
            </tr>
          </thead>
          <tbody>
            {deudores.length === 0 ? (
              <tr><td colSpan="5" style={{textAlign: 'center', padding: '20px'}}>¡No hay clientes con deudas! 🎉</td></tr>
            ) : (
              deudores.map(cliente => (
                <tr key={cliente.id} style={{borderBottom: '1px solid #e5e7eb'}}>
                  <td style={{fontSize: '18px'}}><b>{cliente.nombre}</b></td>
                  <td style={{color: '#ef4444', fontSize: '18px'}}>
                    <b>${formatearDinero(cliente.deuda)}</b>
                  </td>
                  <td style={{color: cliente.envasesAdeudados > 0 ? '#92400e' : '#6b7280', textAlign: 'center'}}>
                    {cliente.envasesAdeudados > 0 ? `${cliente.envasesAdeudados} envase${cliente.envasesAdeudados === 1 ? '' : 's'}` : '0'}
                  </td>
                  
                  <td style={{padding: '10px'}}>
                    <div style={{display: 'flex', gap: '5px', flexDirection: 'column'}}>
                      <select 
                        value={pagoSeleccion[cliente.nombre] || ''}
                        onChange={(e) => setPagoSeleccion({...pagoSeleccion, [cliente.nombre]: e.target.value})}
                        style={estilos.input}
                      >
                        <option value="">-- Selecciona deuda --</option>
                        {cliente.ventasPendientes.map(v => (
                          <option key={v.id} value={v.id}>
                            {v.fechaHoraExacta.split(' ')[0]} - Resta: ${formatearDinero(v.total - (v.abono||0))}
                          </option>
                        ))}
                      </select>
                      <button onClick={() => pagarCompraEspecifica(cliente.nombre, pagoSeleccion[cliente.nombre])} style={estilos.btnVerde}>
                        Pagar Selección
                      </button>
                    </div>
                  </td>

                  <td style={{padding: '10px', background: '#f9fafb'}}>
                    <div style={{display: 'flex', gap: '5px', flexDirection: 'column'}}>
                      <input 
                        type="number"
                        placeholder="Ej: 5000"
                        value={pagoAbono[cliente.nombre] || ''}
                        onChange={(e) => setPagoAbono({...pagoAbono, [cliente.nombre]: e.target.value})}
                        style={estilos.input}
                      />
                      <button onClick={() => abonarCantidad(cliente.nombre, cliente.ventasPendientes)} style={estilos.btnAzul}>
                        Abonar a más antigua
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 3. HISTORIAL DE MOVIMIENTOS GLOBALES */}
      <h2 style={{marginTop: '30px'}}>Historial de Movimientos de Caja</h2>
      <div style={estilos.historialCaja}>
        {movimientos.map(mov => {
          const cambios = Object.entries(mov.cambiosSaldos || {})
            .filter(([, monto]) => Number(monto) !== 0);
          const tieneSalida = cambios.some(([, monto]) => Number(monto) < 0) || (!mov.cambiosSaldos && Number(mov.monto) < 0);
          const colorMovimiento = tieneSalida ? '#ef4444' : '#10b981';

          return (
            <div key={mov.id} style={{...estilos.itemMovimiento, borderLeft: `5px solid ${colorMovimiento}`}}>
              <div>
                <strong>{mov.tipo}</strong>
                <div style={{fontSize: '12px', color: 'gray'}}>{mov.fechaHora}</div>
              </div>

              <div style={{textAlign: 'right', color: colorMovimiento, fontWeight: 'bold', fontSize: '18px'}}>
                {cambios.length > 0 ? cambios.map(([campo, monto]) => (
                  <div key={campo}>
                    {campo.replace('dinero', '')} {Number(monto) > 0 ? '+' : '-'}${formatearDinero(Math.abs(Number(monto)))}
                  </div>
                )) : (
                  <div>Total {Number(mov.monto) > 0 ? '+' : '-'}${formatearDinero(Math.abs(Number(mov.monto || 0)))}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ========================================= */}
      {/* MODAL 1: GESTIÓN DE CLIENTES */}
      {/* ========================================= */}
      {modalClientes && (
        <div style={estilos.modalFondo}>
          <div style={{...estilos.modalContenido, maxWidth: '800px'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
              <h2>Directorio de Clientes</h2>
              <button onClick={() => setModalClientes(false)} style={estilos.btnRojo}>Cerrar</button>
            </div>

            <form onSubmit={guardarCliente} style={estilos.formCliente}>
              <input type="text" placeholder="Nombre (Ej: Juan Pérez)" value={formCliente.nombre} onChange={e => setFormCliente({...formCliente, nombre: e.target.value})} required style={estilos.input}/>
              <input type="text" placeholder="Número / Contacto" value={formCliente.numero} onChange={e => setFormCliente({...formCliente, numero: e.target.value})} style={estilos.input}/>
              <input type="text" placeholder="Descripción breve" value={formCliente.descripcion} onChange={e => setFormCliente({...formCliente, descripcion: e.target.value})} style={{...estilos.input, flex: 2}}/>
              <button type="submit" style={estilos.btnVerde}>{editandoClienteId ? "Actualizar" : "+ Añadir"}</button>
            </form>

            <div style={{maxHeight: '400px', overflowY: 'auto'}}>
              {clientes.map(cli => (
                <div key={cli.id} style={estilos.tarjetaCliente}>
                  <div>
                    <strong>{cli.nombre}</strong> <span style={{color: 'gray'}}>({cli.numero})</span>
                    <p style={{margin: '5px 0', fontSize: '14px'}}>{cli.descripcion}</p>
                  </div>
                  <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap'}}>
                    <button onClick={() => setClienteHistorial(cli.nombre)} style={estilos.btnAzul}>📜 Ver Historial</button>
                    <button onClick={() => prepararEdicionCliente(cli)} style={estilos.btnAmarillo}>✏️</button>
                    <button onClick={() => eliminarCliente(cli.id)} style={estilos.btnRojo}>🗑️</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================= */}
      {/* MODAL 2: HISTORIAL DE COMPRAS DE UN CLIENTE */}
      {/* ========================================= */}
      {clienteHistorial && (
        <div style={{...estilos.modalFondo, zIndex: 1100}}>
          <div style={{...estilos.modalContenido, maxWidth: '600px'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #ccc', paddingBottom: '10px'}}>
              <h2>Historial: {clienteHistorial}</h2>
              <button onClick={() => setClienteHistorial(null)} style={estilos.btnRojo}>Volver</button>
            </div>
            
            <div style={{marginTop: '15px', maxHeight: '400px', overflowY: 'auto'}}>
              {ventas.filter(v => v.clienteNombre === clienteHistorial).length === 0 ? (
                <p>Este cliente no tiene compras registradas.</p>
              ) : (
                ventas.filter(v => v.clienteNombre === clienteHistorial).map(v => (
                  <div key={v.id} style={{padding: '10px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between'}}>
                    <div>
                      <div style={{color: 'gray', fontSize: '12px'}}>{v.fechaHoraExacta}</div>
                      <div>{v.productos.map(p => `${p.cantidad}x ${p.nombre}`).join(', ')}</div>
                    </div>
                    <div style={{textAlign: 'right'}}>
                      <b>${formatearDinero(v.total)}</b><br/>
                      {v.pagado ? (
                        <span style={{color: '#10b981', fontSize: '12px', fontWeight: 'bold'}}>Pagado</span>
                      ) : (
                        <span style={{color: '#ef4444', fontSize: '12px', fontWeight: 'bold'}}>
                          Resta: ${formatearDinero(v.total - (v.abono || 0))}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ESTILOS
const estilos = {
  contenedor: { maxWidth: '1000px', margin: '0 auto', fontFamily: 'sans-serif', paddingBottom: '50px' },
  panelCaja: { background: '#1f2937', padding: '25px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' },
  tarjetaSaldo: { minWidth: '140px', padding: '12px', borderRadius: '6px', background: '#374151', color: 'white' },
  btnClientes: { padding: '15px 25px', fontSize: '16px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' },
  
  tablaContenedor: { overflowX: 'auto', background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', border: '1px solid #e5e7eb' },
  tabla: { width: '100%', borderCollapse: 'collapse', textAlign: 'left' },
  
  historialCaja: { background: 'white', borderRadius: '8px', padding: '15px', maxHeight: '400px', overflowY: 'auto', border: '1px solid #e5e7eb' },
  itemMovimiento: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 10px', borderBottom: '1px solid #f3f4f6', background: '#f9fafb', marginBottom: '8px' },

  modalFondo: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  modalContenido: { background: 'white', padding: '25px', borderRadius: '12px', width: '90%' },
  
  formCliente: { display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap', background: '#f3f4f6', padding: '15px', borderRadius: '8px' },
  input: { padding: '10px', borderRadius: '5px', border: '1px solid #ccc', boxSizing: 'border-box' },
  tarjetaCliente: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px', borderBottom: '1px solid #e5e7eb', flexWrap: 'wrap', gap: '10px' },

  btnVerde: { padding: '10px 15px', background: '#10b981', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' },
  btnAzul: { padding: '10px 15px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' },
  btnRojo: { padding: '10px 15px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' },
  btnAmarillo: { padding: '10px 15px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' },
  
  // Botones pequeños para la caja
  btnVerdePequeño: { padding: '5px 10px', background: '#10b981', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' },
  btnEditarOscuro: { padding: '5px 10px', background: '#374151', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }
};