// Reglas de armas e inventario. Las usan por igual el servidor (PvP) y el navegador (entrenamiento).

export const PLAYER_HP = 100;

export const WEAPONS = {
  sword: { id: 'sword', slot: 'melee', label: 'Espada', reach: 1.55, damage: 34, cooldown: 0.55 },
  axe: {
    id: 'axe', slot: 'melee', label: 'Hacha', reach: 1.3, damage: 44, cooldown: 0.9,
    throwable: true, hitAndThrow: true, throwSpeed: 22, // sin modos: clic corto golpea, mantener y soltar lanza
  },
  spear: {
    id: 'spear', slot: 'spear', label: 'Lanza', reach: 2.6, damage: 38, cooldown: 0.85,
    throwable: true, throwSpeed: 30,
  },
  bow: {
    id: 'bow', slot: 'ranged', label: 'Arco', ammoType: 'arrow', maxAmmo: 12, startAmmo: 12,
    projectile: 'arrow', speed: 68, minPower: 0.15, cooldown: 0.45,
  },
  crossbow: {
    id: 'crossbow', slot: 'ranged', label: 'Ballesta', ammoType: 'bolt', maxAmmo: 6, startAmmo: 6,
    projectile: 'bolt', speed: 100, minPower: 0.9, cooldown: 1.5,
  },
  sling: {
    id: 'sling', slot: 'ranged', label: 'Honda', ammoType: 'stone', maxAmmo: 8, startAmmo: 1,
    projectile: 'stone', speed: 46, minSpeed: 14, minPower: 0.1, cooldown: 0.6,
  },
};

export const PROJECTILES = {
  arrow: { drag: 0.0025, damage: 34, refSpeed: 60, embed: 0.11 },
  bolt: { drag: 0.0012, damage: 52, refSpeed: 90, embed: 0.1 },
  stone: { drag: 0.0045, damage: 20, refSpeed: 40, embed: 0 },
  axe: { drag: 0.003, damage: 60, refSpeed: 20, embed: 0.12 },
  spear: { drag: 0.0018, damage: 52, refSpeed: 26, embed: 0.25 },
};

export const AMMO_ITEMS = ['arrow', 'bolt', 'stone'];
export const SLOTS = ['melee', 'spear', 'ranged'];
export const HEADSHOT_MULT = 1.7;

export const SLOT_LABEL = { melee: 'Cuerpo a cuerpo', spear: 'Lanza', ranged: 'Distancia' };

export function emptyInventory() {
  return { melee: null, spear: false, ranged: null, ammo: 0, selected: 'ranged', throwMode: { axe: false, spear: false } };
}

/** Construye un inventario válido a partir de una petición ({melee, spear, ranged}). Aplica las reglas de exclusión. */
export function makeInventory(loadout = {}, { infinite = false } = {}) {
  const inv = emptyInventory();
  if (loadout.melee === 'sword' || loadout.melee === 'axe') inv.melee = loadout.melee; // espada y hacha comparten hueco
  if (loadout.spear) inv.spear = true;
  if (WEAPONS[loadout.ranged]?.slot === 'ranged') {
    inv.ranged = loadout.ranged; // arco, ballesta y honda comparten hueco
    inv.ammo = infinite ? WEAPONS[inv.ranged].maxAmmo : WEAPONS[inv.ranged].startAmmo;
  }
  ensureSelected(inv);
  return inv;
}

export function hasSlot(inv, slot) {
  return slot === 'spear' ? inv.spear : !!inv[slot];
}

export function weaponInSlot(inv, slot) {
  if (slot === 'spear') return inv.spear ? 'spear' : null;
  return inv[slot] ?? null;
}

export function inventoryWeapons(inv) {
  return SLOTS.map((s) => weaponInSlot(inv, s)).filter(Boolean);
}

export function selectedWeapon(inv) {
  return weaponInSlot(inv, inv.selected);
}

/** Si el hueco seleccionado está vacío, elige otro con arma. */
export function ensureSelected(inv) {
  if (hasSlot(inv, inv.selected)) return;
  inv.selected = SLOTS.find((s) => hasSlot(inv, s)) ?? 'ranged';
}

export function cycleSelected(inv, dir = 1) {
  const owned = SLOTS.filter((s) => hasSlot(inv, s));
  if (!owned.length) return;
  const i = owned.indexOf(inv.selected);
  inv.selected = owned[(i + dir + owned.length) % owned.length];
}

/** Qué hará el botón principal con el arma seleccionada: 'melee' | 'throw' | 'ranged' | null */
export function primaryAction(inv) {
  const id = selectedWeapon(inv);
  if (!id) return null;
  const w = WEAPONS[id];
  if (w.slot === 'ranged') return 'ranged';
  if (isThrowing(inv, id)) return 'throw';
  return 'melee';
}

/** ¿El arma `id` está lista para lanzarse? (las que golpean y se lanzan sin modos, siempre) */
export function isThrowing(inv, id) {
  const w = WEAPONS[id];
  return !!w?.throwable && (!!w.hitAndThrow || !!inv.throwMode[id]);
}

/** ¿Puede golpear ahora cuerpo a cuerpo con el arma seleccionada? */
export function canMelee(inv) {
  const id = selectedWeapon(inv);
  if (!id || !WEAPONS[id].reach) return false;
  return WEAPONS[id].hitAndThrow || primaryAction(inv) === 'melee';
}

export function toggleThrowMode(inv) {
  const id = selectedWeapon(inv);
  if (id && WEAPONS[id].throwable && !WEAPONS[id].hitAndThrow) {
    inv.throwMode[id] = !inv.throwMode[id];
    return true;
  }
  return false;
}

/** Texto de por qué no se puede coger un arma (o null si se puede). */
export function pickBlockReason(inv, weaponId) {
  const w = WEAPONS[weaponId];
  if (!w) return 'Objeto desconocido';
  const held = weaponInSlot(inv, w.slot);
  if (!held) return null;
  if (w.slot === 'melee') return held === weaponId ? 'Ya llevas ese arma' : `No puedes llevar ${w.label.toLowerCase()} y ${WEAPONS[held].label.toLowerCase()} a la vez`;
  if (w.slot === 'ranged') return held === weaponId ? 'Ya llevas ese arma' : `No puedes llevar ${w.label.toLowerCase()} y ${WEAPONS[held].label.toLowerCase()} a la vez`;
  return 'Ya llevas una lanza';
}

export function giveWeapon(inv, weaponId, ammo) {
  const w = WEAPONS[weaponId];
  if (w.slot === 'spear') inv.spear = true;
  else inv[w.slot] = weaponId;
  if (w.slot === 'ranged') inv.ammo = Math.min(w.maxAmmo, ammo ?? w.startAmmo);
  inv.selected = w.slot;
  inv.throwMode[weaponId] = false;
}

/** Quita el arma de su hueco y devuelve la munición que llevaba. */
export function takeWeapon(inv, slot) {
  let ammo = 0;
  if (slot === 'spear') inv.spear = false;
  else {
    if (slot === 'ranged') {
      ammo = inv.ammo;
      inv.ammo = 0;
    }
    inv[slot] = null;
  }
  ensureSelected(inv);
  return ammo;
}

export function ammoFits(inv, ammoType) {
  const w = inv.ranged ? WEAPONS[inv.ranged] : null;
  return !!w && w.ammoType === ammoType && inv.ammo < w.maxAmmo;
}

export function addAmmo(inv, count) {
  const w = WEAPONS[inv.ranged];
  const before = inv.ammo;
  inv.ammo = Math.min(w.maxAmmo, inv.ammo + count);
  return inv.ammo - before;
}

/** Carga inicial permitida del PvP: se valida cualquier cosa que llegue del cliente. */
export function sanitizeLoadout(l = {}) {
  const out = { melee: null, spear: false, ranged: null };
  if (l && (l.melee === 'sword' || l.melee === 'axe')) out.melee = l.melee;
  if (l && l.spear === true) out.spear = true;
  if (l && ['bow', 'crossbow', 'sling'].includes(l.ranged)) out.ranged = l.ranged;
  return out;
}
