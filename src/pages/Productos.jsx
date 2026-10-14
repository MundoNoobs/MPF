import { useState, useEffect } from 'react';
import axios from 'axios';

export default function Productos() {
  // 1. Estados para guardar la información
  const [productos, setProductos] = useState([]);
  const [formulario, setFormulario] = useState({ nombre: '', precio: '', stock: '' });
  const [editandoId, setEditandoId] = useState(null);

  // Esta URL detecta tu IP automáticamente para que funcione en el PC y en el Celular
  const API_URL = `http://${window.location.hostname}:3001/productos`;

  // 2. Leer: Cargar los productos al entrar a la página
  useEffect(() => {
    cargarProductos();
  }, []);

  const cargarProductos = async () => {
    try {
      const respuesta = await axios.get(API_URL);
      setProductos(respuesta.data);
    } catch (error) {
      console.error("Error al cargar productos:", error);
    }
  };

  // 3. Manejar los cambios en las casillas de texto
  const manejarCambio = (e) => {
    const { name, value } = e.target;
    setFormulario({ ...formulario, [name]: value });
  };

  // 4. Añadir o Actualizar producto
  const guardarProducto = async (e) => {
    e.preventDefault(); // Evita que la página se recargue

    // Convertimos texto a número para evitar errores matemáticos después
    const productoA_Guardar = {
      nombre: formulario.nombre,
      precio: Number(formulario.precio),
      stock: Number(formulario.stock)
    };

    try {
      if (editandoId) {
        // ACTUALIZAR (Editar)
        await axios.put(`${API_URL}/${editandoId}`, productoA_Guardar);
        setEditandoId(null);
      } else {
        // AÑADIR (Crear nuevo)
        await axios.post(API_URL, productoA_Guardar);
      }
      
      // Limpiamos el formulario y recargamos la lista
      setFormulario({ nombre: '', precio: '', stock: '' });
      cargarProductos();
    } catch (error) {
      console.error("Error al guardar producto:", error);
    }
  };

  // 5. Preparar la edición
  const prepararEdicion = (producto) => {
    setFormulario({
      nombre: producto.nombre,
      precio: producto.precio,
      stock: producto.stock
    });
    setEditandoId(producto.id);
  };

  // 6. Eliminar
  const eliminarProducto = async (id) => {
    if (window.confirm("¿Seguro que deseas eliminar este producto?")) {
      try {
        await axios.delete(`${API_URL}/${id}`);
        cargarProductos(); // Recargar lista
      } catch (error) {
        console.error("Error al eliminar:", error);
      }
    }
  };

  return (
    <div style={estilos.contenedor}>
      <h2>Gestión de Productos</h2>

      {/* FORMULARIO */}
      <form onSubmit={guardarProducto} style={estilos.formulario}>
        <input
          type="text"
          name="nombre"
          placeholder="Nombre del producto"
          value={formulario.nombre}
          onChange={manejarCambio}
          required
          style={estilos.input}
        />
        <input
          type="number"
          name="precio"
          placeholder="Precio ($)"
          value={formulario.precio}
          onChange={manejarCambio}
          required
          style={estilos.input}
        />
        <input
          type="number"
          name="stock"
          placeholder="Cantidad en Stock"
          value={formulario.stock}
          onChange={manejarCambio}
          required
          style={estilos.input}
        />
        <button type="submit" style={estilos.botonGuardar}>
          {editandoId ? "Actualizar Producto" : "Añadir Producto"}
        </button>
        
        {editandoId && (
          <button 
            type="button" 
            onClick={() => { setEditandoId(null); setFormulario({nombre:'', precio:'', stock:''}); }}
            style={estilos.botonCancelar}
          >
            Cancelar Edición
          </button>
        )}
      </form>

      {/* LISTA DE PRODUCTOS */}
      <div style={estilos.lista}>
        <h3>Inventario Actual ({productos.length})</h3>
        {productos.map(producto => (
          <div key={producto.id} style={estilos.tarjeta}>
            <div>
              <strong>{producto.nombre}</strong> <br/>
              Precio: ${producto.precio} | Stock: {producto.stock} uds.
            </div>
            <div>
              <button onClick={() => prepararEdicion(producto)} style={estilos.botonEditar}>✏️ Editar</button>
              <button onClick={() => eliminarProducto(producto.id)} style={estilos.botonEliminar}>🗑️ Borrar</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Estilos básicos (pensados para que se vea bien en celular y PC)
const estilos = {
  contenedor: { maxWidth: '600px', margin: '0 auto', fontFamily: 'sans-serif' },
  formulario: { display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px', background: '#f5f5f5', padding: '15px', borderRadius: '8px' },
  input: { padding: '10px', fontSize: '16px', borderRadius: '4px', border: '1px solid #ccc' },
  botonGuardar: { padding: '10px', background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', fontSize: '16px', fontWeight: 'bold' },
  botonCancelar: { padding: '10px', background: '#6b7280', color: 'white', border: 'none', borderRadius: '4px', fontSize: '16px' },
  lista: { display: 'flex', flexDirection: 'column', gap: '10px' },
  tarjeta: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff', border: '1px solid #e5e7eb', padding: '15px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' },
  botonEditar: { marginRight: '5px', padding: '5px 10px', cursor: 'pointer', background: '#fef08a', border: 'none', borderRadius: '4px' },
  botonEliminar: { padding: '5px 10px', cursor: 'pointer', background: '#fca5a5', border: 'none', borderRadius: '4px' }
};