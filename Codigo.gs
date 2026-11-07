/**
 * CV Yejarafe · Conexión entre la app y esta hoja de Google.
 *
 * Cómo instalarlo (una sola vez, 3 minutos):
 *  1. En la hoja: menú Extensiones › Apps Script.
 *  2. Borra lo que haya y pega TODO este archivo. Pulsa Guardar (💾).
 *  3. Botón azul "Implementar" › "Nueva implementación".
 *     - Tipo (⚙️): "Aplicación web".
 *     - Ejecutar como: "Yo".
 *     - Quién tiene acceso: "Cualquier usuario".
 *  4. Pulsa "Implementar", autoriza con tu cuenta (Google avisará de que la app no está verificada:
 *     "Configuración avanzada" › "Ir a … (no seguro)" › "Permitir"; es tu propio script).
 *  5. Copia la "URL de la aplicación web" (termina en /exec) y pégala en la app: Más › Datos y Google.
 *
 * La app guarda todo en la pestaña oculta "_datos" y además rellena pestañas legibles
 * (Plantilla, Asistencia, Estadísticas, Cuotas) para consultarlas desde el ordenador.
 * No edites a mano la pestaña "_datos".
 */

const DATA_SHEET = '_datos';
const CHUNK = 45000; // caracteres por celda (el límite de Sheets es 50.000)

function doGet(e) {
  return json({ ok: true, db: readDb() });
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (body.a === 'save') {
      const cur = readDb();
      // Si otro móvil guardó después de la última vez que este móvil leyó, devolvemos los datos actuales para combinarlos.
      if (cur && cur.updatedAt && body.base !== cur.updatedAt && cur.updatedAt > (body.base || 0)) {
        return json({ ok: false, conflict: true, db: cur });
      }
      writeDb(body.db);
      try { writeViews(body.db); } catch (err) { /* las pestañas legibles son opcionales */ }
      return json({ ok: true });
    }
    if (body.a === 'rsvp') {
      const db = readDb();
      if (!db) return json({ ok: false, error: 'sin datos' });
      const s = db.sessions.find(x => x.id === body.sid);
      if (!s || !db.players.some(p => p.id === body.pid) || ['si', 'no', 'duda'].indexOf(body.v) < 0) {
        return json({ ok: false, error: 'no encontrado' });
      }
      s.rsvp = s.rsvp || {}; s.rsvpT = s.rsvpT || {};
      s.rsvp[body.pid] = body.v; s.rsvpT[body.pid] = Date.now();
      db.updatedAt = Date.now();
      writeDb(db);
      return json({ ok: true });
    }
    return json({ ok: false, error: 'acción desconocida' });
  } finally {
    lock.releaseLock();
  }
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function sheet(name) {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function readDb() {
  const sh = SpreadsheetApp.getActive().getSheetByName(DATA_SHEET);
  if (!sh || sh.getLastRow() === 0) return null;
  const txt = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(r => String(r[0]).replace(/^~/, '')).join('');
  return txt ? JSON.parse(txt) : null;
}

function writeDb(db) {
  const sh = sheet(DATA_SHEET);
  const txt = JSON.stringify(db);
  const rows = [];
  for (let i = 0; i < txt.length; i += CHUNK) rows.push(['~' + txt.substr(i, CHUNK)]); // el ~ evita que Sheets interprete el texto
  sh.clear();
  sh.getRange(1, 1, rows.length, 1).setNumberFormat('@').setValues(rows);
  if (!sh.isSheetHidden()) sh.hideSheet();
}

function writeViews(db) {
  const players = db.players.slice().sort((a, b) => (+a.number || 999) - (+b.number || 999));
  const name = id => (db.players.find(p => p.id === id) || {}).name || '';
  const ATT = { P: 'Presente', A: 'Ausente', T: 'Tarde', J: 'Justificado' };
  const sessions = db.sessions.slice().sort((a, b) => a.date.localeCompare(b.date));
  const pct = pid => { let n = 0, ok = 0; sessions.forEach(s => { const v = s.att[pid]; if (v) { n++; if (v === 'P' || v === 'T') ok++; } }); return n ? Math.round(ok * 100 / n) + '%' : ''; };

  const age = b => { if (!b) return ''; const d = new Date(b + 'T12:00'), n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--; return a; };
  put('Plantilla', [['Dorsal', 'Nombre', 'Posición', 'Teléfono', 'Nacimiento', 'Edad', 'Altura (cm)', 'Peso (kg)', 'Alcance ataque', 'Alcance bloqueo', 'Mano', '% asistencia']]
    .concat(players.map(p => [p.number, p.name, p.pos, p.phone || '', p.birth || '', age(p.birth), p.height || '', p.weight || '', p.spike || '', p.block || '', p.hand || '', pct(p.id)])));

  put('Asistencia', [['Dorsal', 'Nombre'].concat(sessions.map(s => s.date + ' ' + s.type + (s.title ? ' ' + s.title : '')))]
    .concat(players.map(p => [p.number, p.name].concat(sessions.map(s => ATT[s.att[p.id]] || '')))));

  const ms = sessions.filter(s => s.type === 'partido');
  const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : '';
  put('Estadísticas', [['Dorsal', 'Nombre', 'Partidos', 'Ataque', 'Bloqueo', 'Saque', 'Puntos', 'Errores', 'Recepción media', 'Saque medio']]
    .concat(players.map(p => {
      const r = { A: 0, B: 0, S: 0, E: 0 }, rec = [], srv = [];
      ms.forEach(s => (s.ev || []).forEach(e => {
        if (e.p !== p.id) return;
        if (e.t === 'r') rec.push(e.v); else if (e.t === 'q') srv.push(e.v); else if (r[e.t] !== undefined) r[e.t]++;
      }));
      const pj = ms.filter(s => s.att[p.id] === 'P' || s.att[p.id] === 'T').length;
      return [p.number, p.name, pj, r.A, r.B, r.S, r.A + r.B + r.S, r.E, avg(rec), avg(srv)];
    })));

  const fees = db.fees || [];
  put('Cuotas', [['Dorsal', 'Nombre'].concat(fees.map(f => f.name + ' (' + f.amount + ' €)'))]
    .concat(players.map(p => [p.number, p.name].concat(fees.map(f => (f.paid || {})[p.id] ? 'Pagado' : 'Pendiente')))));

  put('Gastos', [['Fecha', 'Tipo', 'Concepto', 'Importe']]
    .concat((db.money || []).slice().sort((a, b) => a.date.localeCompare(b.date)).map(m => [m.date, m.kind === 'in' ? 'Ingreso' : 'Gasto', m.concept, (m.kind === 'in' ? 1 : -1) * m.amount])));

  const TN = { cmj: 'Salto vertical CMJ (cm)', spikejump: 'Alcance con batida (cm)', blockjump: 'Alcance de bloqueo (cm)', squat: 'Sentadilla (kg)', hipthrust: 'Hip thrust (kg)', bench: 'Press de banca (kg)', pullups: 'Dominadas (rep)', med: 'Balón medicinal 3 kg (m)', plank: 'Plancha (s)', agility: 'Agilidad 9-3-6-3-9 (s)', sprint: 'Sprint 20 m (s)', bw: 'Peso corporal (kg)' };
  put('Pruebas físicas', [['Fecha', 'Dorsal', 'Nombre', 'Prueba', 'Resultado']]
    .concat((db.tests || []).slice().sort((a, b) => a.date.localeCompare(b.date)).map(t => { const p = db.players.find(x => x.id === t.pid) || {}; return [t.date, p.number || '', p.name || '', TN[t.t] || t.t, t.v]; })));

  const lrows = [['Liga', 'Pos.', 'Equipo', 'PJ', 'G', 'P', 'Puntos', 'Sets a favor', 'Sets en contra']];
  (db.leagues || []).forEach(L => {
    const T = {}; L.teams.forEach(t => T[t.id] = { n: t.name, pj: 0, g: 0, p: 0, pts: 0, sf: 0, sc: 0 });
    L.matches.forEach(m => {
      let h = 0, a = 0;
      if (m.sets && m.sets.length) m.sets.forEach(x => { if (x[0] > x[1]) h++; else if (x[1] > x[0]) a++; });
      else if (m.hs != null) { h = +m.hs; a = +m.as; }
      if ((h < 3 && a < 3) || !T[m.home] || !T[m.away]) return;
      const H = T[m.home], A = T[m.away]; H.pj++; A.pj++; H.sf += h; H.sc += a; A.sf += a; A.sc += h;
      const W = h > a ? H : A, Lo = h > a ? A : H, five = h + a === 5; W.g++; Lo.p++; W.pts += five ? 2 : 3; Lo.pts += five ? 1 : 0;
    });
    Object.values(T).sort((x, y) => y.pts - x.pts || y.g - x.g || (y.sf / (y.sc || 1)) - (x.sf / (x.sc || 1)))
      .forEach((r, i) => lrows.push([L.name, i + 1, r.n, r.pj, r.g, r.p, r.pts, r.sf, r.sc]));
  });
  put('Ligas', lrows);

  put('Notas', [['Fecha', 'Título', 'Jugadora', 'Texto']]
    .concat((db.notes || []).slice().sort((a, b) => a.date.localeCompare(b.date)).map(n => [n.date, n.title || '', name(n.player), n.text])));
}

function put(name, rows) {
  const sh = sheet(name);
  sh.clear();
  const w = Math.max.apply(null, rows.map(r => r.length));
  const data = rows.map(r => r.concat(Array(w - r.length).fill('')));
  sh.getRange(1, 1, data.length, w).setValues(data);
  sh.getRange(1, 1, 1, w).setFontWeight('bold').setBackground('#dbeafe');
  sh.setFrozenRows(1);
}
