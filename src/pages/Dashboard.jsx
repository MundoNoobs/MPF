import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import SyncPanel from '../components/SyncPanel';

export default function Dashboard() {
  const HOST = `http://${window.location.hostname}:3001`;

  // --- ESTADOS ---
  const [productos, setProductos] = useState([]);
  
  // Guardamos los 5 pines en la memoria local del dispositivo (PC o Teléfono)
  const [pines, setPines] = useState(() => {
    const pinesGuardados = localStorage.getItem('dashboard_pines');
    return pinesGuardados ? JSON.parse(pinesGuardados) : [null, null, null, null, null];
  });

  const [modalAbierto, setModalAbierto] = useState(false);
  const [slotSeleccionado, setSlotSeleccionado] = useState(null); // Saber qué cuadro (0 al 4) estamos configurando

  // 1. Cargar el inventario actual
  useEffect(() => {
    cargarProductos();
  }, []);

  const cargarProductos = async () => {
    try {
      const res = await axios.get(`${HOST}/productos`);
      setProductos(res.data);
    } catch (error) {
      console.error("Error al cargar productos:", error);
    }
  };

  // 2. Guardar los pines cada vez que cambien
  useEffect(() => {
    localStorage.setItem('dashboard_pines', JSON.stringify(pines));
  }, [pines]);

  // 3. Lógica para fijar un producto en un cuadro
  const abrirModalPin = (indexSlot) => {
    setSlotSeleccionado(indexSlot);
    setModalAbierto(true);
  };

  const fijarProducto = (productoId) => {
    const nuevosPines = [...pines];
    nuevosPines[slotSeleccionado] = String(productoId);
    setPines(nuevosPines);
    setModalAbierto(false);
  };

  const liberarCuadro = (indexSlot) => {
    const nuevosPines = [...pines];
    nuevosPines[indexSlot] = null;
    setPines(nuevosPines);
  };

  return (
    <div style={estilos.contenedor}>
      
      {/* 1. SECCIÓN DE NAVEGACIÓN RÁPIDA (4 BOTONES) */}
      <h2 style={{color: '#1f2937'}}>Acceso Rápido</h2>
      <div style={estilos.gridBotones}>
        <Link to="/productos" style={{...estilos.botonNavegacion, background: '#8b5cf6'}}>
          <div style={{fontSize: '30px'}}>📦</div>
          Inventario
        </Link>
        <Link to="/ventas" style={{...estilos.botonNavegacion, background: '#10b981'}}>
          <div style={{fontSize: '30px'}}>🛒</div>
          Ventas por Día
        </Link>
        <Link to="/gastos" style={{...estilos.botonNavegacion, background: '#ef4444'}}>
          <div style={{fontSize: '30px'}}>💸</div>
          Mis Gastos
        </Link>
        <Link to="/resumen" style={{...estilos.botonNavegacion, background: '#f59e0b'}}>
          <div style={{fontSize: '30px'}}>📊</div>
          Resumen General
        </Link>
      </div>

      <hr style={{margin: '30px 0', borderColor: '#e5e7eb'}} />

      {/* SINCRONIZACIÓN DE DB CON EL SISTEMA WEB */}
      <SyncPanel />

      <hr style={{margin: '30px 0', borderColor: '#e5e7eb'}} />

      {/* 2. SECCIÓN DE MONITOREO DE STOCK (5 CUADROS) */}
      <h2 style={{color: '#1f2937'}}>Monitoreo de Stock en Vivo</h2>
      <div style={estilos.gridCuadros}>
        {pines.map((pinId, index) => {
          // Buscamos el producto en la base de datos
          const producto = productos.find(p => String(p.id) === String(pinId));

          if (!producto) {
            // CUADRO VACÍO (Muestra el botón +)
            return (
              <div key={index} style={estilos.cuadroVacio} onClick={() => abrirModalPin(index)}>
                <div style={{fontSize: '40px', color: '#9ca3af'}}>+</div>
                <div style={{color: 'gray', fontSize: '14px'}}>Fijar Producto</div>
              </div>
            );
          } else {
            // CUADRO CON PRODUCTO
            const stockCritico = producto.stock < 5;
            return (
              <div key={index} style={{...estilos.cuadroLleno, border: stockCritico ? '2px solid #ef4444' : '2px solid #10b981'}}>
                <button onClick={() => liberarCuadro(index)} style={estilos.botonLiberar}>❌</button>
                <div style={{fontSize: '16px', fontWeight: 'bold', color: '#374151', textAlign: 'center', minHeight: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                  {producto.nombre}
                </div>
                <div style={{...estilos.numeroStock, color: stockCritico ? '#ef4444' : '#10b981'}}>
                  {producto.stock}
                </div>
                <div style={{fontSize: '12px', color: 'gray'}}>en inventario</div>
              </div>
            );
          }
        })}
      </div>

      {/* MODAL PARA SELECCIONAR PRODUCTO A FIJAR */}
      {modalAbierto && (
        <div style={estilos.modalFondo}>
          <div style={estilos.modalContenido}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px'}}>
              <h3 style={{margin: 0}}>¿Qué producto quieres vigilar aquí?</h3>
              <button onClick={() => setModalAbierto(false)} style={estilos.botonLiberar}>❌</button>
            </div>
            
            <div style={{maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px'}}>
              {productos.length === 0 ? (
                <p>No tienes productos registrados en tu inventario aún.</p>
              ) : (
                productos.map(p => (
                  <button 
                    key={p.id} 
                    onClick={() => fijarProducto(p.id)}
                    style={estilos.botonSeleccionarProducto}
                  >
                    <span><b>{p.nombre}</b></span>
                    <span style={{color: 'gray'}}>Stock actual: {p.stock}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ESTILOS (Pensados para celular y PC)
const estilos = {
  contenedor: { maxWidth: '1000px', margin: '0 auto', fontFamily: 'sans-serif', paddingBottom: '30px' },
  
  // Botones Superiores
  gridBotones: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' },
  botonNavegacion: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', color: 'white', textDecoration: 'none', borderRadius: '12px', fontWeight: 'bold', fontSize: '18px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', transition: 'transform 0.2s' },
  
  // Cuadros de Stock
  gridCuadros: { display: 'flex', flexWrap: 'wrap', gap: '15px', justifyContent: 'center' },
  cuadroVacio: { width: '150px', height: '150px', border: '2px dashed #ccc', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: '#f9fafb' },
  cuadroLleno: { width: '150px', height: '150px', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'white', position: 'relative', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', padding: '10px', boxSizing: 'border-box' },
  numeroStock: { fontSize: '48px', fontWeight: '900', lineHeight: '1' },
  botonLiberar: { position: 'absolute', top: '5px', right: '5px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '12px' },
  
  // Modal
  modalFondo: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  modalContenido: { background: 'white', padding: '25px', borderRadius: '12px', width: '90%', maxWidth: '400px' },
  botonSeleccionarProducto: { display: 'flex', justifyContent: 'space-between', padding: '15px', border: '1px solid #e5e7eb', borderRadius: '8px', background: 'white', cursor: 'pointer', fontSize: '16px', textAlign: 'left' }
};