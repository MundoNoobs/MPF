import axios from 'axios';

export const CAMPOS_SALDO = {
  total: 'dineroTotal',
  compra: 'dineroCompra',
  reserva: 'dineroReserva'
};

export const obtenerSaldos = (caja = {}) => ({
  total: Number(caja.dineroTotal || 0),
  compra: Number(caja.dineroCompra || 0),
  reserva: Number(caja.dineroReserva || 0)
});

export async function aplicarCambiosSaldos(HOST, cambios, tipo, fechaHora) {
  const camposPermitidos = Object.values(CAMPOS_SALDO);
  const cambiosValidos = Object.fromEntries(
    Object.entries(cambios).filter(([campo, monto]) => camposPermitidos.includes(campo) && Number.isFinite(Number(monto)))
  );

  if (Object.keys(cambiosValidos).length === 0) {
    throw new Error('No hay cambios de saldo válidos.');
  }

  const respuesta = await axios.get(`${HOST}/caja`);
  const cajaAnterior = respuesta.data;
  const cajaActualizada = { ...cajaAnterior };

  for (const [campo, cambio] of Object.entries(cambiosValidos)) {
    cajaActualizada[campo] = Number(cajaAnterior[campo] || 0) + Number(cambio);
  }

  await axios.patch(`${HOST}/caja`, cajaActualizada);

  try {
    await axios.post(`${HOST}/movimientos`, {
      fechaHora,
      tipo,
      monto: Number(cambiosValidos.dineroTotal || 0),
      cambiosSaldos: cambiosValidos
    });
  } catch (error) {
    await axios.patch(`${HOST}/caja`, cajaAnterior);
    throw error;
  }

  return cajaActualizada;
}
