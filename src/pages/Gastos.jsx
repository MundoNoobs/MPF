import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import { aplicarCambiosSaldos } from '../utils/finanzas';

export default function Gastos() {
  const HOST = `http://${window.location.hostname}:3001`;

  // --- ESTADOS ---
  const [gastos, setGastos] = useState([]);
  const [gastosRecurrentes, setGastosRecurrentes] = useState([]); // Nueva lista
  const [productos, setProductos] = useState([]);
  
  // Estados para el Carrito
  const [carrito, setCarrito] = useState([]);
  const [nombreItem, setNombreItem] = useState('');
  const [precioItem, setPrecioItem] = useState('');
  const [cantidadItem, setCantidadItem] = useState(1);
  const [saldoGasto, setSaldoGasto] = useState('dineroTotal');

  // Estados para Administrar Gastos Recurrentes
  const [nuevoRecurrenteNombre, setNuevoRecurrenteNombre] = useState('');
  const [nuevoRecurrentePrecio, setNuevoRecurrentePrecio] = useState('');
  const [productoRecurrenteId, setProductoRecurrenteId] = useState('');
  const [unidadesPorPack, setUnidadesPorPack] = useState(1);
  const [editandoRecurrenteId, setEditandoRecurrenteId] = useState(null);
  const [recurrenteSeleccionadoId, setRecurrenteSeleccionadoId] = useState('');

  const cargarDatos = useCallback(async () => {
    try {
      const resG = await axios.get(`${HOST}/gastos`);
      setGastos(resG.data.reverse()); // Los más nuevos arriba

      const resR = await axios.get(`${HOST}/gastosRecurrentes`);
      setGastosRecurrentes(resR.data);

      const resP = await axios.get(`${HOST}/productos`);
      setProductos(resP.data);
    } catch (error) {
      console.error("Error al cargar datos:", error);
    }
  }, [HOST]);

  // 1. Cargar datos al entrar
  useEffect(() => {
    void Promise.resolve().then(cargarDatos);
  }, [cargarDatos]);

  // --- LÓGICA DE GASTOS RECURRENTES (NUEVO) ---

  // Cuando eliges un gasto de la lista, autocompleta los campos
  const manejarSeleccionRecurrente = (e) => {
    const id = e.target.value;
    setRecurrenteSeleccionadoId(id);
    if (!id) {
      setNombreItem('');
      setPrecioItem('');
      return;
    }
    const recurrente = gastosRecurrentes.find(g => String(g.id) === String(id));
    if (recurrente) {
      setNombreItem(recurrente.nombre);
      setPrecioItem(recurrente.precio);
      setCantidadItem(1);
    }
  };

  const guardarGastoRecurrente = async (e) => {
    e.preventDefault();
    const precio = Number(nuevoRecurrentePrecio);
    const unidades = Number(unidadesPorPack);
    if (precio <= 0 || (productoRecurrenteId && (!Number.isInteger(unidades) || unidades <= 0))) {
      return alert('Indica un precio y una cantidad de unidades válidos.');
    }

    try {
      const datosRecurrente = {
        nombre: nuevoRecurrenteNombre,
        precio,
        productoId: productoRecurrenteId || null,
        unidadesPorPack: productoRecurrenteId ? unidades : 1
      };
      if (editandoRecurrenteId) {
        await axios.put(`${HOST}/gastosRecurrentes/${editandoRecurrenteId}`, datosRecurrente);
      } else {
        await axios.post(`${HOST}/gastosRecurrentes`, datosRecurrente);
      }
      setNuevoRecurrenteNombre('');
      setNuevoRecurrentePrecio('');
      setProductoRecurrenteId('');
      setUnidadesPorPack(1);
      setEditandoRecurrenteId(null);
      cargarDatos();
    } catch (error) {
      console.error("Error al guardar recurrente:", error);
    }
  };

  const prepararEdicionRecurrente = (recurrente) => {
    setEditandoRecurrenteId(recurrente.id);
    setNuevoRecurrenteNombre(recurrente.nombre);
    setNuevoRecurrentePrecio(recurrente.precio);
    setProductoRecurrenteId(recurrente.productoId || '');
    setUnidadesPorPack(recurrente.unidadesPorPack || 1);
  };

  const eliminarGastoRecurrente = async (id) => {
    if (window.confirm("¿Borrar este gasto de tu lista de frecuentes?")) {
      await axios.delete(`${HOST}/gastosRecurrentes/${id}`);
      cargarDatos();
    }
  };

  // --- LÓGICA DEL CARRITO Y GASTOS (IGUAL QUE ANTES) ---

  const añadirAlCarrito = (e) => {
    e.preventDefault(); 
    if (!nombreItem || precioItem <= 0 || cantidadItem <= 0) {
      alert("Por favor, llena todos los campos correctamente.");
      return;
    }

    const subtotal = Number(precioItem) * Number(cantidadItem);
    const recurrente = gastosRecurrentes.find(g => String(g.id) === String(recurrenteSeleccionadoId));
    const nuevoItem = {
      idTemp: Date.now(),
      nombre: nombreItem,
      precio: Number(precioItem),
      cantidad: Number(cantidadItem),
      subtotal,
      recurrenteId: recurrente?.id || null,
      productoId: recurrente?.productoId || null,
      unidadesPorPack: recurrente?.unidadesPorPack || 1
    };

    setCarrito([...carrito, nuevoItem]);
    setNombreItem('');
    setPrecioItem('');
    setCantidadItem(1);
    
    // Resetea el selector de recurrentes dejándolo en blanco
    setRecurrenteSeleccionadoId('');
  };

  const quitarDelCarrito = (idTemp) => {
    setCarrito(carrito.filter(item => item.idTemp !== idTemp));
  };

  const totalCarrito = carrito.reduce((suma, item) => suma + item.subtotal, 0);

  const confirmarGastos = async () => {
    if (carrito.length === 0) return;

    const ahora = new Date();
    const cambiosSaldos = { [saldoGasto]: -totalCarrito };
    const cambiosStock = new Map();
    const unidadesPorItem = new Map();
    for (const item of carrito) {
      if (item.productoId) {
        const unidades = Number(item.cantidad) * Number(item.unidadesPorPack || 1);
        cambiosStock.set(item.productoId, (cambiosStock.get(item.productoId) || 0) + unidades);
        unidadesPorItem.set(item.idTemp, unidades);
      }
    }
    const nuevoRegistroGasto = {
      fechaDia: format(ahora, 'yyyy-MM-dd'),
      fechaHoraExacta: format(ahora, 'yyyy-MM-dd HH:mm:ss'),
      items: carrito.map(item => ({ ...item, unidadesIngresadas: unidadesPorItem.get(item.idTemp) || 0 })),
      total: totalCarrito,
      cambiosSaldos
    };

    const stockAplicado = [];
    let gastoCreado;
    try {
      const productosAntes = await axios.get(`${HOST}/productos`);
      const respuestaGasto = await axios.post(`${HOST}/gastos`, nuevoRegistroGasto);
      gastoCreado = respuestaGasto.data;

      for (const [productoId, unidades] of cambiosStock) {
        const producto = productosAntes.data.find(p => String(p.id) === String(productoId));
        if (!producto) throw new Error(`No se encontró el producto ${productoId}.`);
        await axios.patch(`${HOST}/productos/${productoId}`, { stock: Number(producto.stock) + unidades });
        stockAplicado.push({ productoId, stockAnterior: producto.stock });
      }

      await aplicarCambiosSaldos(HOST, cambiosSaldos, 'Compra de pack / salida por gasto', format(ahora, 'yyyy-MM-dd HH:mm:ss'));

      const nombreSaldo = { dineroTotal: 'Total', dineroCompra: 'Compra', dineroReserva: 'Reserva' }[saldoGasto];
      alert(`Gasto de $${totalCarrito} registrado y descontado de ${nombreSaldo}. El stock asociado fue actualizado.`);
      
      setCarrito([]);
      cargarDatos();
    } catch (error) {
      for (const producto of stockAplicado) {
        await axios.patch(`${HOST}/productos/${producto.productoId}`, { stock: producto.stockAnterior });
      }
      if (gastoCreado?.id) await axios.delete(`${HOST}/gastos/${gastoCreado.id}`);
      console.error("Error al registrar el gasto:", error);
    }
  };

  const eliminarGastoHistorico = async (gasto) => {
    if (!window.confirm(`¿Seguro que deseas eliminar este gasto de $${gasto.total}? El saldo utilizado y el stock asociado se revertirán.`)) return;

    const cambiosStock = new Map();
    for (const item of gasto.items || []) {
      if (!item.productoId) continue;
      const unidades = Number(item.unidadesIngresadas ?? Number(item.cantidad) * Number(item.unidadesPorPack || 1));
      cambiosStock.set(item.productoId, (cambiosStock.get(item.productoId) || 0) + unidades);
    }

    const stockRevertido = [];
    const cambiosSaldos = gasto.cambiosSaldos && Object.keys(gasto.cambiosSaldos).length
      ? Object.fromEntries(Object.entries(gasto.cambiosSaldos).map(([campo, monto]) => [campo, -Number(monto)]))
      : { dineroTotal: Number(gasto.total) };
    let saldosRevertidos = false;
    try {
      const productosActuales = await axios.get(`${HOST}/productos`);
      for (const [productoId, unidades] of cambiosStock) {
        const producto = productosActuales.data.find(p => String(p.id) === String(productoId));
        if (!producto) continue;
        await axios.patch(`${HOST}/productos/${productoId}`, { stock: Number(producto.stock) - unidades });
        stockRevertido.push({ productoId, stockAnterior: producto.stock });
      }

      await aplicarCambiosSaldos(HOST, cambiosSaldos, 'Anulación de gasto', format(new Date(), 'yyyy-MM-dd HH:mm:ss'));
      saldosRevertidos = true;

      await axios.delete(`${HOST}/gastos/${gasto.id}`);
      cargarDatos();
    } catch (error) {
      for (const producto of stockRevertido) {
        await axios.patch(`${HOST}/productos/${producto.productoId}`, { stock: producto.stockAnterior });
      }
      if (saldosRevertidos) {
        const reversa = Object.fromEntries(Object.entries(cambiosSaldos).map(([campo, monto]) => [campo, -Number(monto)]));
        await aplicarCambiosSaldos(HOST, reversa, 'Reversión de anulación de gasto', format(new Date(), 'yyyy-MM-dd HH:mm:ss'));
      }
      console.error("Error al eliminar gasto:", error);
    }
  };

  return (
    <div style={estilos.contenedor}>
      <h2 style={{color: '#1f2937'}}>Gestión de Gastos</h2>

      <div style={estilos.panelSuperior}>
        
        {/* COLUMNA IZQUIERDA: Añadir al carrito y Administrar Recurrentes */}
              <div style={{flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '20px'}}>
          
          {/* CAJA 1: Añadir al Carrito */}
          <div style={estilos.tarjeta}>
            <h3 style={{marginTop: 0}}>Añadir Ítem</h3>
            
            {/* NUEVO: Selector de Gastos Frecuentes */}
            {gastosRecurrentes.length > 0 && (
              <select 
                id="selector-recurrentes"
                value={recurrenteSeleccionadoId}
                onChange={manejarSeleccionRecurrente}
                style={{...estilos.input, marginBottom: '10px', background: '#eff6ff'}}
              >
                <option value="">-- Usar un gasto frecuente --</option>
                {gastosRecurrentes.map(g => (
                  <option key={g.id} value={g.id}>{g.nombre} (${g.precio}{g.productoId ? ` / ${g.unidadesPorPack || 1} uds.` : ''})</option>
                ))}
              </select>
            )}

            <form onSubmit={añadirAlCarrito} style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
              <input 
                type="text" 
                placeholder="Nombre (Ej: Combustible)" 
                value={nombreItem}
                onChange={e => setNombreItem(e.target.value)}
                style={estilos.input}
                required
              />
              <div style={{display: 'flex', gap: '10px'}}>
                <input 
                  type="number" 
                  placeholder="Precio ($)" 
                  value={precioItem}
                  onChange={e => setPrecioItem(e.target.value)}
                  style={{...estilos.input, flex: 2}}
                  required
                />
                <input 
                  type="number" 
                  placeholder={gastosRecurrentes.find(g => String(g.id) === String(recurrenteSeleccionadoId))?.productoId ? 'Packs' : 'Cant.'}
                  min="1"
                  value={cantidadItem}
                  onChange={e => setCantidadItem(e.target.value)}
                  style={{...estilos.input, flex: 1}}
                  required
                />
              </div>
              <button type="submit" style={estilos.botonAñadir}>+ Agregar al Carrito</button>
            </form>
          </div>

          {/* CAJA 2: Crear Plantillas de Gastos */}
          <div style={{...estilos.tarjeta, border: '1px dashed #ccc'}}>
            <h4 style={{marginTop: 0, color: '#4b5563'}}>{editandoRecurrenteId ? 'Editar gasto frecuente' : 'Crear Nuevo Gasto Frecuente'}</h4>
            <form onSubmit={guardarGastoRecurrente} style={{display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px'}}>
              <input 
                type="text" 
                placeholder="Nombre" 
                value={nuevoRecurrenteNombre}
                onChange={e => setNuevoRecurrenteNombre(e.target.value)}
                style={{...estilos.input, padding: '8px'}}
                required
              />
              <input 
                type="number" 
                placeholder="Precio total del pack / gasto" 
                min="1"
                step="1"
                value={nuevoRecurrentePrecio}
                onChange={e => setNuevoRecurrentePrecio(e.target.value)}
                style={{...estilos.input, padding: '8px'}}
                required
              />
              <select value={productoRecurrenteId} onChange={e => setProductoRecurrenteId(e.target.value)} style={estilos.input}>
                <option value="">Gasto normal, sin producto</option>
                {productos.map(producto => <option key={producto.id} value={producto.id}>{producto.nombre}</option>)}
              </select>
              {productoRecurrenteId && (
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={unidadesPorPack}
                  onChange={e => setUnidadesPorPack(e.target.value)}
                  placeholder="Unidades por pack"
                  style={estilos.input}
                  required
                />
              )}
              <div style={{display: 'flex', gap: '8px'}}>
                <button type="submit" style={{background: '#10b981', color: 'white', border: 'none', borderRadius: '5px', padding: '9px 12px', cursor: 'pointer'}}>{editandoRecurrenteId ? 'Guardar cambios' : 'Crear plantilla'}</button>
                {editandoRecurrenteId && <button type="button" onClick={() => { setEditandoRecurrenteId(null); setNuevoRecurrenteNombre(''); setNuevoRecurrentePrecio(''); setProductoRecurrenteId(''); setUnidadesPorPack(1); }} style={estilos.botonQuitar}>Cancelar</button>}
              </div>
            </form>

            {/* Lista de gastos frecuentes guardados */}
            <div style={{maxHeight: '100px', overflowY: 'auto'}}>
              {gastosRecurrentes.map(g => (
                <div key={g.id} style={{display: 'flex', justifyContent: 'space-between', fontSize: '14px', borderBottom: '1px solid #eee', padding: '5px 0'}}>
                  <span>{g.nombre} (${g.precio}){g.productoId ? ` · ${g.unidadesPorPack || 1} uds. de ${productos.find(p => String(p.id) === String(g.productoId))?.nombre || 'producto'}` : ''}</span>
                  <span style={{display: 'flex', gap: '4px'}}>
                    <button onClick={() => prepararEdicionRecurrente(g)} style={estilos.botonQuitar}>✏️</button>
                    <button onClick={() => eliminarGastoRecurrente(g.id)} style={estilos.botonQuitar}>❌</button>
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* COLUMNA DERECHA: El carrito en sí */}
        <div style={{...estilos.tarjeta, background: '#f9fafb', border: '1px solid #e5e7eb', flex: '1 1 300px'}}>
          <h3 style={{marginTop: 0}}>Carrito de Gastos</h3>
          
          {carrito.length === 0 ? (
            <p style={{color: 'gray', textAlign: 'center'}}>No has añadido nada aún.</p>
          ) : (
            <>
              <div style={estilos.listaCarrito}>
                {carrito.map(item => (
                  <div key={item.idTemp} style={estilos.itemCarrito}>
                    <div>
                      <strong>{item.cantidad}x {item.nombre}{item.productoId ? ` · ${item.cantidad * item.unidadesPorPack} unidades` : ''}</strong>
                      <div style={{fontSize: '14px', color: '#4b5563'}}>{item.productoId ? `$${item.precio} por pack · $${Number(item.precio) / Number(item.unidadesPorPack || 1)} por unidad` : `$${item.precio} c/u`}</div>
                    </div>
                    <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                      <b>${item.subtotal}</b>
                      <button onClick={() => quitarDelCarrito(item.idTemp)} style={estilos.botonQuitar}>❌</button>
                    </div>
                  </div>
                ))}
              </div>
              
              <div style={estilos.totalContainer}>
                <h3>Total Gastos: ${totalCarrito}</h3>
                <label style={{display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', marginBottom: '10px'}}>
                  <span>Descontar de:</span>
                  <select value={saldoGasto} onChange={e => setSaldoGasto(e.target.value)} style={estilos.input}>
                    <option value="dineroTotal">Total</option>
                    <option value="dineroCompra">Compra</option>
                    <option value="dineroReserva">Reserva</option>
                  </select>
                </label>
                <button onClick={confirmarGastos} style={estilos.botonConfirmar}>
                  Confirmar compra y actualizar saldos/stock
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* HISTORIAL DE GASTOS */}
      <div style={{marginTop: '30px'}}>
        <h3>Historial de Gastos</h3>
        {gastos.length === 0 ? (
          <p style={{color: 'gray'}}>No hay gastos registrados en el historial.</p>
        ) : (
          <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
            {gastos.map(gasto => (
              <div key={gasto.id} style={estilos.tarjetaHistorial}>
                <div style={{flex: 1}}>
                  <div style={{color: 'gray', fontSize: '12px'}}>{gasto.fechaHoraExacta}</div>
                  <ul style={{margin: '5px 0', paddingLeft: '20px', fontSize: '14px'}}>
                    {(gasto.items || []).map((item, i) => (
                      <li key={i}>{item.cantidad}x {item.nombre} - ${item.subtotal}{item.productoId ? ` · +${item.unidadesIngresadas ?? item.cantidad * (item.unidadesPorPack || 1)} uds.` : ''}</li>
                    ))}
                  </ul>
                </div>
                <div style={{display: 'flex', alignItems: 'center', gap: '15px'}}>
                  <h3 style={{margin: 0, color: '#ef4444'}}>-${gasto.total}</h3>
                  <button onClick={() => eliminarGastoHistorico(gasto)} style={estilos.botonQuitar}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

// ESTILOS
const estilos = {
  contenedor: { maxWidth: '900px', margin: '0 auto', fontFamily: 'sans-serif' },
  panelSuperior: { display: 'flex', gap: '20px', flexWrap: 'wrap' },
  tarjeta: { background: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' },
  input: { padding: '10px', borderRadius: '5px', border: '1px solid #ccc', boxSizing: 'border-box', width: '100%' },
  botonAñadir: { padding: '12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '5px', fontWeight: 'bold', cursor: 'pointer' },
  listaCarrito: { maxHeight: '200px', overflowY: 'auto', marginBottom: '10px' },
  itemCarrito: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #e5e7eb' },
  botonQuitar: { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '16px' },
  totalContainer: { borderTop: '2px solid #ccc', paddingTop: '15px', textAlign: 'right' },
  botonConfirmar: { width: '100%', padding: '15px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '5px', fontWeight: 'bold', cursor: 'pointer', fontSize: '16px' },
  tarjetaHistorial: { background: 'white', padding: '15px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderLeft: '5px solid #ef4444', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
};