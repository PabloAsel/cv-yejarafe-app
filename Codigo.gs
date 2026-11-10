/**
 * CV Yejarafe · Conexión entre la app y esta hoja de Google. (versión 5)
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

// Versión 2: los datos completos solo se leen con la clave del equipo (la pone la app de los entrenadores).
// Las jugadoras y las familias solo reciben lo justo: nombres para confirmar y el marcador.
function key() { return PropertiesService.getScriptProperties().getProperty('KEY') || ''; }
// Versión 5: clave de solo lectura (delegados y directivos) y calendario para suscribirse desde el móvil.
function roKey() { return PropertiesService.getScriptProperties().getProperty('KEY_RO') || ''; }
const TZ = 'Atlantic/Canary'; // zona horaria de los entrenos y partidos

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.a === 'pub' || p.a === 'live') {
    const db = readDb();
    if (!db) return json({ ok: false, error: 'sin datos' });
    const s = db.sessions.find(x => x.id === p.sid);
    if (!s) return json({ ok: false, error: 'no encontrado' });
    const ses = { id: s.id, type: s.type, date: s.date, time: s.time || '', title: s.title || '', place: s.place || '' };
    if (p.a === 'live') return json({ ok: true, team: db.team, session: ses, live: s.live || null });
    const t0 = (db.teams && db.teams[0] && db.teams[0].id) || 't0';
    const players = db.players.filter(x => (x.tm || t0) === (s.tm || t0)).map(x => ({ id: x.id, name: x.name, number: x.number || '' }));
    return json({ ok: true, team: db.team, session: ses, players: players });
  }
  if (p.a === 'agenda') return json(agenda(p.tm));
  if (p.a === 'ics') return ContentService.createTextOutput(ics(p.tm)).setMimeType(ContentService.MimeType.ICAL);
  const k = key();
  if (k && p.k !== k) {
    const ro = roKey();
    if (ro && p.k === ro) return json({ ok: true, db: readDb(), ro: true });
    return json({ ok: false, error: 'clave' });
  }
  return json({ ok: true, db: readDb() });
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (body.a === 'save') {
      const k = key();
      if (k && body.k !== k) return json({ ok: false, error: (roKey() && body.k === roKey()) ? 'lectura' : 'clave' });
      if (body.db && typeof body.db.rok === 'string' && body.db.rok !== roKey()) PropertiesService.getScriptProperties().setProperty('KEY_RO', body.db.rok);
      if (!k && body.k) PropertiesService.getScriptProperties().setProperty('KEY', String(body.k));
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
    if (body.a === 'well') {
      const db = readDb();
      if (!db) return json({ ok: false, error: 'sin datos' });
      const s = db.sessions.find(x => x.id === body.sid);
      const v = body.v || {};
      const okN = n => typeof n === 'number' && n >= 1 && n <= 10;
      if (!s || !db.players.some(p => p.id === body.pid) || !okN(v.rpe) || !okN(v.fat) || !okN(v.sleep) || !okN(v.pain)) {
        return json({ ok: false, error: 'no encontrado' });
      }
      s.well = s.well || {};
      s.well[body.pid] = { rpe: v.rpe, fat: v.fat, sleep: v.sleep, pain: v.pain, note: String(v.note || '').slice(0, 200), t: Date.now() };
      db.updatedAt = Date.now();
      writeDb(db);
      return json({ ok: true });
    }
    return json({ ok: false, error: 'acción desconocida' });
  } finally {
    lock.releaseLock();
  }
}

// Versión 4: agenda pública de un equipo. Solo fechas, lugares, resultados y clasificación; ningún nombre ni dato de jugadores.
function agenda(tm) {
  const db = readDb();
  if (!db) return { ok: false, error: 'sin datos' };
  const teams = db.teams || [];
  const t0 = (teams[0] && teams[0].id) || 't0';
  const t = teams.find(x => x.id === tm) || teams[0] || { id: t0 };
  const from = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  const sessions = (db.sessions || []).filter(s => (s.tm || t0) === t.id && s.date >= from).map(s => {
    const o = { id: s.id, type: s.type, date: s.date, time: s.time || '', title: s.title || '', place: s.place || '' };
    if (s.type === 'partido' && s.live && (s.live.won || s.live.lost)) o.res = { won: s.live.won || 0, lost: s.live.lost || 0 };
    return o;
  });
  const name = t.name || [t.cat, (t.gen || '').toLowerCase(), t.sub].filter(Boolean).join(' ') || '';
  const out = { ok: true, team: db.team, name: name, sessions: sessions };
  const L = (db.leagues || []).find(l => (l.teams || []).some(x => t.fed ? x.id === t.fed : x.mine));
  if (L) {
    const me = L.teams.find(x => t.fed ? x.id === t.fed : x.mine);
    out.fed = me.id;
    out.league = {
      id: L.id, name: L.name, official: L.official || [],
      teams: L.teams.map(x => ({ id: x.id, name: x.name, logo: /^https?:/.test(x.logo || '') ? x.logo : '' })),
      matches: (L.matches || []).map(m => ({ id: m.id, home: m.home, away: m.away, date: m.date || '', time: m.time || '', venue: m.venue || '', j: m.j || 0, sets: m.sets || [], hs: m.hs, as: m.as, postponed: !!m.postponed }))
    };
  }
  return out;
}

function ics(tm) {
  const a = agenda(tm);
  const esc = t => String(t || '').replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n');
  const utc = d => Utilities.formatDate(d, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
  const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CV Yejarafe//App//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + esc((a.team || 'Equipo') + (a.name ? ' · ' + a.name : '')), 'X-WR-TIMEZONE:' + TZ, 'REFRESH-INTERVAL;VALUE=DURATION:PT3H', 'X-PUBLISHED-TTL:PT3H'];
  (a.sessions || []).filter(s => s.date >= from).forEach(s => {
    const title = (s.type === 'partido' ? '🏐 Partido' + (s.title ? ' vs ' + s.title : '') : '🏐 Entreno' + (s.title ? ' · ' + s.title : ''));
    L.push('BEGIN:VEVENT', 'UID:' + s.id + '@app-voleibol', 'DTSTAMP:' + utc(new Date()));
    if (/^\d\d:\d\d$/.test(s.time)) {
      const d = Utilities.parseDate(s.date + ' ' + s.time, TZ, 'yyyy-MM-dd HH:mm');
      L.push('DTSTART:' + utc(d), 'DTEND:' + utc(new Date(d.getTime() + 2 * 3600e3)));
    } else {
      const n = new Date(s.date + 'T12:00:00Z'); n.setUTCDate(n.getUTCDate() + 1);
      L.push('DTSTART;VALUE=DATE:' + s.date.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + n.toISOString().slice(0, 10).replace(/-/g, ''));
    }
    L.push('SUMMARY:' + esc(title));
    if (s.place) L.push('LOCATION:' + esc(s.place));
    L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(title), 'TRIGGER:-PT2H', 'END:VALARM', 'END:VEVENT');
  });
  L.push('END:VCALENDAR');
  return L.join('\r\n');
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
  // Varios equipos: si el club tiene más de uno, cada pestaña lleva delante la columna "Equipo".
  const teams = db.teams || [];
  const multi = teams.length > 1;
  const t0 = (teams[0] && teams[0].id) || 't0';
  const tname = x => { const t = teams.find(y => y.id === (x.tm || t0)) || {}; return t.name || [t.cat, (t.gen || '').toLowerCase(), t.sub].filter(Boolean).join(' ') || 'Equipo principal'; };
  const players = db.players.slice().sort((a, b) => (multi ? tname(a).localeCompare(tname(b)) : 0) || (+a.number || 999) - (+b.number || 999));
  const name = id => (db.players.find(p => p.id === id) || {}).name || '';
  const putT = (tab, rows) => put(tab, multi ? rows.map((r, i) => [i === 0 ? 'Equipo' : tname(players[i - 1])].concat(r)) : rows);
  const ATT = { P: 'Presente', A: 'Ausente', T: 'Tarde', J: 'Justificado' };
  const sessions = db.sessions.slice().sort((a, b) => a.date.localeCompare(b.date));
  const pct = pid => { let n = 0, ok = 0; sessions.forEach(s => { const v = s.att[pid]; if (v) { n++; if (v === 'P' || v === 'T') ok++; } }); return n ? Math.round(ok * 100 / n) + '%' : ''; };

  const age = b => { if (!b) return ''; const d = new Date(b + 'T12:00'), n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--; return a; };
  putT('Plantilla', [['Dorsal', 'Nombre', 'Posición', 'Teléfono', 'Nacimiento', 'Edad', 'Altura (cm)', 'Peso (kg)', 'Alcance ataque', 'Alcance bloqueo', 'Mano', '% asistencia']]
    .concat(players.map(p => [p.number, p.name, p.pos, p.phone || '', p.birth || '', age(p.birth), p.height || '', p.weight || '', p.spike || '', p.block || '', p.hand || '', pct(p.id)])));

  putT('Asistencia', [['Dorsal', 'Nombre'].concat(sessions.map(s => s.date + ' ' + s.type + (s.title ? ' ' + s.title : '')))]
    .concat(players.map(p => [p.number, p.name].concat(sessions.map(s => ATT[s.att[p.id]] || '')))));

  const ms = sessions.filter(s => s.type === 'partido');
  const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : '';
  putT('Estadísticas', [['Dorsal', 'Nombre', 'Partidos', 'Ataque', 'Bloqueo', 'Saque', 'Puntos', 'Errores', 'Recepción media', 'Saque medio']]
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
  putT('Cuotas', [['Dorsal', 'Nombre'].concat(fees.map(f => f.name + ' (' + f.amount + ' €)'))]
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

  const wrows = [['Fecha', 'Sesión', 'Dorsal', 'Nombre', 'Dureza (RPE)', 'Minutos', 'Carga', 'Cansancio', 'Sueño', 'Dolor', 'Nota']];
  sessions.forEach(s => Object.keys(s.well || {}).forEach(pid => {
    const w = s.well[pid], p = db.players.find(x => x.id === pid) || {}, min = +s.dur || 90;
    wrows.push([s.date, s.type + (s.title ? ' ' + s.title : ''), p.number || '', p.name || '', w.rpe, min, w.rpe * min, w.fat, w.sleep, w.pain, w.note || '']);
  }));
  put('Carga', wrows);

  put('Lesiones', [['Dorsal', 'Nombre', 'Lesión', 'Desde', 'Vuelta prevista']]
    .concat(players.filter(p => p.inj).map(p => [p.number, p.name, p.inj.what || '', p.inj.since || '', p.inj.back || ''])));

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
