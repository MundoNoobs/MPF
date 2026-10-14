import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { format, addDays, subDays } from 'date-fns'; 
import { aplicarCambiosSaldos } from '../utils/finanzas';

export default function Ventas() {
  const HOST = `http://${window.location.hostname}:3001`;

  // --- ESTADOS PRINCIPALES ---
  const [fechaVista, setFechaVista] = useState(new Date()); 
  const [ventas, setVentas] = useState([]);
  const [productos, setProductos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [gastosRecurrentes, setGastosRecurrentes] = useState([]);
  const [envasesEditados, setEnvasesEditados] = useState({});
  
  // --- ESTADOS DEL POP-UP (MODAL) ---
  const [modalAbierto, setModalAbierto] = useState(false);
  const [clienteSeleccionado, setClienteSeleccionado] = useState('');
  const [carrito, setCarrito] = useState([]); 
  const [productoTemporal, setProductoTemporal] = useState('');
  const [cantidadTemporal, setCantidadTemporal] = useState(1);

  const cargarDatos = useCallback(async () => {
    try {
      const resVentas = await axios.get(`${HOST}/ventas`);
      const resProd = await axios.get(`${HOST}/productos`);
      const resCli = await axios.get(`${HOST}/clientes`);
      const resRec = await axios.get(`${HOST}/gastosRecurrentes`);
      setVentas(resVentas.data);
      setProductos(resProd.data);
      setClientes(resCli.data);
      setGastosRecurrentes(resRec.data);
    } catch (error) {
      console.error("Error al cargar la base de datos:", error);
    }
  }, [HOST]);

  // 1. Cargar todos los datos
  useEffect(() => {
    void Promise.resolve().then(cargarDatos);
  }, [cargarDatos]);

  // 2. Filtrar ventas
  const fechaFormateada = format(fechaVista, 'yyyy-MM-dd');
  const ventasDelDia = ventas.filter(v => v.fechaDia === fechaFormateada);

  // 3. Manejo del Carrito
  const añadirAlCarrito = () => {
    if (!productoTemporal || cantidadTemporal <= 0) return;
    
    const prodRef = productos.find(p => String(p.id) === String(productoTemporal));
    
    if (!prodRef) {
      alert("Error: No se encontró el producto.");
      return;
    }

    if (prodRef.stock < cantidadTemporal) {
      alert(`¡No hay suficiente stock! Solo quedan ${prodRef.stock} uds.`);
      return;
    }

    const subtotal = prodRef.precio * cantidadTemporal;
    const nuevoItem = {
      productoId: prodRef.id,
      nombre: prodRef.nombre,
      cantidad: Number(cantidadTemporal),
      subtotal: subtotal
    };
    
    setCarrito([...carrito, nuevoItem]);
    setProductoTemporal(''); // Resetea el selector
    setCantidadTemporal(1);
  };

  const totalCarrito = carrito.reduce((suma, item) => suma + item.subtotal, 0);

  // 4. Guardar Venta
  const guardarVenta = async () => {
    if (!clienteSeleccionado) return alert("Selecciona o escribe el nombre de un cliente");
    if (carrito.length === 0) return alert("Añade al menos un producto al carrito");

    const ahora = new Date();
    
    const nuevaVenta = {
      clienteNombre: clienteSeleccionado,
      fechaDia: fechaFormateada,
      fechaHoraExacta: `${fechaFormateada} ${format(ahora, 'HH:mm:ss')}`,
      productos: carrito,
      total: totalCarrito,
      pagado: false,
      enCaja: false
    };

    try {
      await axios.post(`${HOST}/ventas`, nuevaVenta);

      for (let item of carrito) {
        const prodDB = productos.find(p => String(p.id) === String(item.productoId));
        if (prodDB) {
          await axios.patch(`${HOST}/productos/${item.productoId}`, {
            stock: prodDB.stock - item.cantidad
          });
        }
      }

      setModalAbierto(false);
      setCarrito([]);
      setClienteSeleccionado('');
      cargarDatos(); 
    } catch (error) {
      console.error("Error al guardar:", error);
    }
  };

  // 5. Eliminar Venta y Restaurar Stock
  const eliminarVenta = async (venta) => {
    const mensajeAlerta = venta.enCaja 
      ? "⚠️ Esta venta YA fue sumada al Dinero Total.\n\nSi la eliminas, se RESTARÁ ese dinero de tu caja y se devolverá el stock a los productos.\n\n¿Estás seguro?" 
      : "¿Estás seguro de que quieres eliminar esta venta? El stock de los productos vendidos se restaurará.";

    if (!window.confirm(mensajeAlerta)) return;

    const cambiosStock = new Map();
    for (const item of venta.productos || []) {
      cambiosStock.set(item.productoId, (cambiosStock.get(item.productoId) || 0) + Number(item.cantidad));
    }
    const stockAplicado = [];
    const cambiosSaldo = {};
    if (venta.enCaja) cambiosSaldo.dineroTotal = -Number(venta.total);
    if (Number(venta.costoCompraAsignado || 0)) cambiosSaldo.dineroCompra = -Number(venta.costoCompraAsignado);
    if (Number(venta.dineroReservaAsignado || 0)) cambiosSaldo.dineroReserva = -Number(venta.dineroReservaAsignado);
    let saldosRevertidos = false;

    try {
      const resProductos = await axios.get(`${HOST}/productos`);
      for (const [productoId, cantidad] of cambiosStock) {
        const prodDB = resProductos.data.find(p => String(p.id) === String(productoId));
        if (prodDB) {
          await axios.patch(`${HOST}/productos/${productoId}`, { stock: Number(prodDB.stock) + cantidad });
          stockAplicado.push({ productoId, stockAnterior: prodDB.stock });
        }
      }

      if (Object.keys(cambiosSaldo).length) {
        await aplicarCambiosSaldos(HOST, cambiosSaldo, 'Eliminación de venta', format(new Date(), 'yyyy-MM-dd HH:mm:ss'));
        saldosRevertidos = true;
      }

      await axios.delete(`${HOST}/ventas/${venta.id}`);
      cargarDatos();
    } catch (error) {
      for (const producto of stockAplicado) {
        await axios.patch(`${HOST}/productos/${producto.productoId}`, { stock: producto.stockAnterior });
      }
      if (saldosRevertidos) {
        await aplicarCambiosSaldos(HOST, Object.fromEntries(Object.entries(cambiosSaldo).map(([campo, monto]) => [campo, -monto])), 'Reversión de eliminación incompleta', format(new Date(), 'yyyy-MM-dd HH:mm:ss'));
      }
      console.error("Error al eliminar la venta:", error);
    }
  };

  // 6. Marcar Pagado / No Pagado
  const togglePagado = async (venta) => {
    const hora = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
    const cambiosSaldo = {};

    if (venta.pagado) {
      const compra = Number(venta.costoCompraAsignado || 0);
      const reserva = Number(venta.dineroReservaAsignado || 0);
      const compraAnterior = Number(venta.compraAntesDelPago || 0);
      const reservaAnterior = Number(venta.reservaAntesDelPago || 0);
      if (compra > compraAnterior) cambiosSaldo.dineroCompra = compraAnterior - compra;
      if (reserva > reservaAnterior) cambiosSaldo.dineroReserva = reservaAnterior - reserva;
      let saldosRevertidos = false;

      try {
        if (Object.keys(cambiosSaldo).length) {
          await aplicarCambiosSaldos(HOST, cambiosSaldo, 'Reversión de cobro de venta', hora);
          saldosRevertidos = true;
        }
        await axios.patch(`${HOST}/ventas/${venta.id}`, {
          pagado: false,
          abono: Number(venta.abonoAntesDelPago || 0),
          costoCompraAsignado: compraAnterior,
          dineroReservaAsignado: reservaAnterior,
          abonoAntesDelPago: null,
          compraAntesDelPago: null,
          reservaAntesDelPago: null
        });
      } catch (error) {
        if (saldosRevertidos) {
          await aplicarCambiosSaldos(HOST, Object.fromEntries(Object.entries(cambiosSaldo).map(([campo, monto]) => [campo, -monto])), 'Reversión de anulación incompleta', hora);
        }
        console.error('Error al revertir el cobro:', error);
      }
      cargarDatos();
      return;
    }

    const packsSeleccionados = { ...(venta.packsSeleccionados || {}) };
    let costoReposicionTotal = 0;
    for (const item of venta.productos || []) {
      const packs = gastosRecurrentes.filter(pack => String(pack.productoId) === String(item.productoId));
      if (!packs.length) continue;

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
        if (seleccion === null || !Number.isInteger(indice) || indice < 0 || indice >= packs.length) return;
        pack = packs[indice];
      }

      packsSeleccionados[item.productoId] = {
        id: pack.id,
        nombre: pack.nombre,
        precio: Number(pack.precio),
        unidadesPorPack: Number(pack.unidadesPorPack || 1)
      };
      costoReposicionTotal += Number(item.cantidad) * Number(pack.precio) / Number(pack.unidadesPorPack || 1);
    }

    const montoCobrado = Number(venta.total) - Number(venta.abono || 0);
    const compra = Math.min(montoCobrado, Math.max(0, costoReposicionTotal - Number(venta.costoCompraAsignado || 0)));
    const reserva = montoCobrado - compra;
    try {
      await aplicarCambiosSaldos(HOST, { dineroCompra: compra, dineroReserva: reserva }, 'Cobro de venta', hora);
      try {
        await axios.patch(`${HOST}/ventas/${venta.id}`, {
          pagado: true,
          abono: Number(venta.total),
          packsSeleccionados,
          costoReposicionTotal,
          costoCompraAsignado: Number(venta.costoCompraAsignado || 0) + compra,
          dineroReservaAsignado: Number(venta.dineroReservaAsignado || 0) + reserva,
          abonoAntesDelPago: Number(venta.abono || 0),
          compraAntesDelPago: Number(venta.costoCompraAsignado || 0),
          reservaAntesDelPago: Number(venta.dineroReservaAsignado || 0)
        });
      } catch (error) {
        await aplicarCambiosSaldos(HOST, { dineroCompra: -compra, dineroReserva: -reserva }, 'Reversión de cobro incompleto', hora);
        throw error;
      }
      cargarDatos();
    } catch (error) {
      console.error('Error al registrar el cobro:', error);
    }
  };

  const actualizarEntregaEnvase = async (venta, valor) => {
    const entregoEnvase = valor === '' ? null : valor === 'true';
    const envasesAdeudados = entregoEnvase === false ? Number(venta.envasesAdeudados || 1) : 0;
    try {
      await axios.patch(`${HOST}/ventas/${venta.id}`, { entregoEnvase, envasesAdeudados });
      if (entregoEnvase === false) {
        setEnvasesEditados(prev => ({ ...prev, [venta.id]: envasesAdeudados }));
      } else {
        setEnvasesEditados(prev => {
          const actualizados = { ...prev };
          delete actualizados[venta.id];
          return actualizados;
        });
      }
      cargarDatos();
    } catch (error) {
      console.error('Error al actualizar la entrega de envase:', error);
    }
  };

  const guardarCantidadEnvases = async (venta) => {
    const cantidad = Number(envasesEditados[venta.id] ?? venta.envasesAdeudados ?? 1);
    if (!Number.isInteger(cantidad) || cantidad < 1) {
      return alert('La cantidad de envases adeudados debe ser un entero mayor que cero.');
    }
    try {
      await axios.patch(`${HOST}/ventas/${venta.id}`, { entregoEnvase: false, envasesAdeudados: cantidad });
      cargarDatos();
    } catch (error) {
      console.error('Error al guardar la cantidad de envases:', error);
    }
  };

  return (
    <div style={estilos.contenedor}>
      {/* CABECERA */}
      <div style={estilos.cabeceraDias}>
        <button onClick={() => setFechaVista(subDays(fechaVista, 1))} style={estilos.botonNavegacion}>⬅️ Ant.</button>
        <div style={estilos.contenedorFecha}>
          <h2 style={{margin: 0, fontSize: '16px'}}>Ventas del Día</h2>
          <input 
            type="date"
            value={format(fechaVista, 'yyyy-MM-dd')}
            onChange={(e) => {
              if(e.target.value) {
                setFechaVista(new Date(e.target.value + 'T12:00:00'));
              }
            }}
            style={estilos.inputFecha}
          />
        </div>
        <button onClick={() => setFechaVista(addDays(fechaVista, 1))} style={estilos.botonNavegacion}>Sig. ➡️</button>
      </div>

      <button onClick={() => setModalAbierto(true)} style={estilos.botonNuevaVenta}>+ Añadir Nueva Venta</button>

      {/* TABLA DE VENTAS */}
      <div style={estilos.tablaContenedor}>
        <table style={estilos.tabla}>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Productos</th>
              <th>Total</th>
              <th>¿Pagado?</th>
              <th>¿Entregó envase?</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {ventasDelDia.length === 0 ? (
              <tr><td colSpan="6" style={{textAlign:'center', padding:'20px'}}>No hay ventas registradas este día.</td></tr>
            ) : (
              ventasDelDia.map(venta => (
                <tr key={venta.id} style={{background: venta.pagado ? '#ecfdf5' : 'white'}}>
                  <td>{venta.clienteNombre} <br/><small style={{color:'gray'}}>{venta.fechaHoraExacta.split(' ')[1]}</small></td>
                  <td>
                    {venta.productos.map((p, i) => (
                      <div key={i}>{p.cantidad}x {p.nombre}</div>
                    ))}
                  </td>
                  <td><b>${venta.total}</b></td>
                  <td style={{textAlign: 'center'}}>
                    <input 
                      type="checkbox" 
                      checked={venta.pagado} 
                      onChange={() => togglePagado(venta)}
                      style={estilos.checkboxGrande}
                    />
                  </td>
                  <td style={{textAlign: 'center', whiteSpace: 'nowrap'}}>
                    <select
                      value={venta.entregoEnvase === true ? 'true' : venta.entregoEnvase === false ? 'false' : ''}
                      onChange={e => actualizarEntregaEnvase(venta, e.target.value)}
                      style={estilos.inputFecha}
                    >
                      <option value="">Sin registrar</option>
                      <option value="true">Sí</option>
                      <option value="false">No</option>
                    </select>
                    {venta.entregoEnvase === false && (
                      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', marginTop: '4px'}}>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          aria-label={`Envases adeudados por ${venta.clienteNombre}`}
                          value={envasesEditados[venta.id] ?? venta.envasesAdeudados ?? 1}
                          onChange={e => setEnvasesEditados(prev => ({ ...prev, [venta.id]: e.target.value }))}
                          onBlur={() => guardarCantidadEnvases(venta)}
                          style={{...estilos.inputFecha, width: '58px'}}
                        />
                        <small>adeudados</small>
                      </div>
                    )}
                  </td>
                  <td style={{textAlign: 'center'}}>
                    <button onClick={() => eliminarVenta(venta)} style={estilos.botonEliminar}>🗑️</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL NUEVA VENTA */}
      {modalAbierto && (
        <div style={estilos.modalFondo}>
          <div style={estilos.modalContenido}>
            <h3>Registrar Nueva Venta</h3>
            
            <label><b>Cliente:</b></label>
            <input 
              type="text" 
              placeholder="Ej: Juan Pérez" 
              value={clienteSeleccionado}
              onChange={(e) => setClienteSeleccionado(e.target.value)}
              style={estilos.inputGlobal}
              list="lista-clientes"
            />
            <datalist id="lista-clientes">
              {clientes.map(c => <option key={c.id} value={c.nombre} />)}
            </datalist>

            <div style={estilos.zonaCarrito}>
              <label><b>Añadir Producto:</b></label>
              <div style={{display:'flex', gap:'5px'}}>
                <select 
                  value={String(productoTemporal)} 
                  onChange={(e) => setProductoTemporal(e.target.value)}
                  style={{...estilos.inputGlobal, marginBottom: 0, flex: 1}}
                >
                  <option value="">-- Elige un producto --</option>
                  {productos.map(p => (
                    <option key={p.id} value={String(p.id)}>{p.nombre} (Disp: {p.stock} | ${p.precio})</option>
                  ))}
                </select>
                <input 
                  type="number" 
                  min="1" 
                  value={cantidadTemporal}
                  onChange={(e) => setCantidadTemporal(e.target.value)}
                  style={{width: '60px', ...estilos.inputGlobal, marginBottom: 0}}
                />
                <button type="button" onClick={añadirAlCarrito} style={estilos.botonMas}>+</button>
              </div>

              <div style={{marginTop: '15px', background:'#f9fafb', padding:'10px', borderRadius: '5px'}}>
                <h4 style={{marginTop: 0}}>Carrito Actual:</h4>
                {carrito.length === 0 ? <p style={{margin:0, color:'gray'}}>El carrito está vacío</p> : null}
                
                {carrito.map((item, index) => (
                  <div key={index} style={{display:'flex', justifyContent:'space-between', borderBottom:'1px solid #ddd', padding:'5px 0'}}>
                    <span>{item.cantidad}x {item.nombre}</span>
                    <span>${item.subtotal}</span>
                  </div>
                ))}
                <h3 style={{textAlign:'right', marginTop:'10px'}}>Total: ${totalCarrito}</h3>
              </div>
            </div>

            <div style={{display:'flex', gap:'10px', marginTop:'20px'}}>
              <button onClick={guardarVenta} style={estilos.botonGuardarModal}>Confirmar Venta</button>
              <button onClick={() => {setModalAbierto(false); setCarrito([]); setProductoTemporal('');}} style={estilos.botonCancelarModal}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ESTILOS
const estilos = {
  contenedor: { maxWidth: '800px', margin: '0 auto', fontFamily: 'sans-serif' },
  cabeceraDias: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#3b82f6', color: 'white', padding: '15px', borderRadius: '8px', marginBottom: '15px' },
  contenedorFecha: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' },
  inputFecha: { padding: '5px 10px', borderRadius: '5px', border: 'none', fontWeight: 'bold', cursor: 'pointer', textAlign: 'center' },
  botonNavegacion: { background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '10px 15px', borderRadius: '5px', cursor: 'pointer', fontWeight:'bold' },
  botonNuevaVenta: { width: '100%', padding: '15px', fontSize: '18px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', marginBottom: '15px', fontWeight: 'bold' },
  tablaContenedor: { overflowX: 'auto', background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' },
  tabla: { width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' },
  checkboxGrande: { width: '22px', height: '22px', cursor: 'pointer' },
  botonEliminar: { background: '#ef4444', border: 'none', borderRadius: '4px', padding: '5px 8px', cursor: 'pointer', fontSize: '16px' },
  
  modalFondo: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  modalContenido: { background: 'white', padding: '25px', borderRadius: '12px', width: '90%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto' },
  inputGlobal: { padding: '10px', border: '1px solid #ccc', borderRadius: '5px', width: '100%', boxSizing: 'border-box', marginBottom: '10px' },
  zonaCarrito: { border: '1px solid #e5e7eb', padding: '15px', borderRadius: '8px', marginTop: '10px' },
  botonMas: { background: '#3b82f6', color: 'white', border: 'none', borderRadius: '5px', padding: '0 15px', fontSize: '20px', cursor: 'pointer', fontWeight:'bold' },
  botonGuardarModal: { flex: 1, padding: '15px', background: '#10b981', color: 'white', border: 'none', borderRadius: '5px', fontWeight: 'bold', cursor: 'pointer' },
  botonCancelarModal: { flex: 1, padding: '15px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '5px', fontWeight: 'bold', cursor: 'pointer' }
};