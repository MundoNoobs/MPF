// src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { activarModoOffline } from './utils/offlineSync.js'

// Activa el motor Offline y el radar hacia 192.168.1.119:3001
activarModoOffline();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)