import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';

// Importamos las 5 páginas que acabas de crear
import Dashboard from './pages/Dashboard';
import Productos from './pages/Productos';
import Ventas from './pages/Ventas';
import Gastos from './pages/Gastos';
import Resumen from './pages/Resumen';
import Mensualidades from './pages/Mensualidades';

export default function App() {
  return (
    <Router>
      <div>
        {/* BARRA DE NAVEGACIÓN (Tus botones) */}
        <nav style={estilos.navbar}>
          <Link to="/" style={estilos.boton}>Inicio</Link>
          <Link to="/productos" style={estilos.boton}>Productos</Link>
          <Link to="/ventas" style={estilos.boton}>Ventas por Día</Link>
          <Link to="/gastos" style={estilos.boton}>Gastos</Link>
          <Link to="/mensualidades" style={estilos.boton}>Mensualidades</Link>
          <Link to="/resumen" style={estilos.boton}>Resumen</Link>
        </nav>

        {/* CONTENIDO QUE CAMBIA SEGÚN EL BOTÓN */}
        <div style={estilos.contenedor}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/productos" element={<Productos />} />
            <Route path="/ventas" element={<Ventas />} />
            <Route path="/gastos" element={<Gastos />} />
            <Route path="/mensualidades" element={<Mensualidades />} />
            <Route path="/resumen" element={<Resumen />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

// Estilos temporales para que se vea ordenado en tu celular
const estilos = {
  navbar: {
    display: 'flex',
    gap: '10px',
    padding: '15px',
    background: '#1e1e1e',
    flexWrap: 'wrap',
    justifyContent: 'center'
  },
  boton: {
    color: 'white',
    textDecoration: 'none',
    padding: '8px 12px',
    background: '#3b82f6',
    borderRadius: '5px',
    fontWeight: 'bold'
  },
  contenedor: {
    padding: '20px'
  }
};