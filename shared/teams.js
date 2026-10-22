// Escuadras de las salas «en escuadras». Sin escuadras (todos contra todos) los jugadores no tienen equipo.
export const TEAMS = [
  { name: 'Rojo', color: '#e0453a' },
  { name: 'Azul', color: '#3f8ee8' },
  { name: 'Verde', color: '#4cc063' },
  { name: 'Amarillo', color: '#e8c33a' },
  { name: 'Morado', color: '#a566e0' },
  { name: 'Naranja', color: '#ee8a2e' },
];
export const MAX_TEAMS = TEAMS.length; // 6 parejas en dúos (12 jugadores)
export const MAX_SQUADS = 4; // escuadras grandes
export const teamName = (i) => TEAMS[i]?.name ?? '';
export const teamColor = (i) => TEAMS[i]?.color ?? '#ffffff';
