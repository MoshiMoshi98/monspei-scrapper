const axios = require('axios');
const dayjs = require('dayjs');
const utc   = require('dayjs/plugin/utc');
const tzp   = require('dayjs/plugin/timezone');
const fs    = require('fs');
const path  = require('path');
dayjs.extend(utc);
dayjs.extend(tzp);

// ─── COLORES TERMINAL ───────────────────────────────────────────
const V  = '\x1b[32m';  // verde
const R  = '\x1b[31m';  // rojo
const AM = '\x1b[33m';  // amarillo — entidades nuevas
const B  = '\x1b[1m';   // bold
const X  = '\x1b[0m';   // reset

// ─── CONFIG ─────────────────────────────────────────────────────
const ZONA     = 'America/Mexico_City';
const ENDPOINT = 'https://www.banxico.org.mx/monspei/mostrarInformacion.do';
const DIR      = './salidas';
const MARGEN   = 5 * 60 * 1000;

// ─── ARCHIVO DE ESTADO ANTERIOR ─────────────────────────────────
const ESTADO_FILE = path.join(DIR, 'estado_anterior.json');

const HEADERS = {
  'User-Agent':       'Mozilla/5.0 Chrome/121.0.0.0 Safari/537.36',
  'Accept':           'application/json, text/javascript; q=0.01',
  'Content-Type':     'application/x-www-form-urlencoded; charset=UTF-8',
  'X-Requested-With': 'XMLHttpRequest',
  'Origin':           'https://www.banxico.org.mx',
  'Referer':          'https://www.banxico.org.mx/monspei/',
};

// ─── HELPERS ────────────────────────────────────────────────────
const fmt   = ts => dayjs(ts).tz(ZONA).format('DD/MM/YY HH:mm:ss');
const ahora = ()  => dayjs().tz(ZONA).format('DD/MM/YYYY HH:mm:ss');

// sortPeriodos — garantiza leer siempre el periodo más reciente
const sortPeriodos = (p) => {
  if (!Array.isArray(p) || p.length === 0) return [];
  return [...p].sort((a, b) => b.fin - a.fin);
};

const isConn = (p) => {
  if (!Array.isArray(p) || p.length === 0) return false;
  const sorted = sortPeriodos(p);
  return (Date.now() - sorted[0].fin) <= MARGEN;
};

// ─── LEER ESTADO ANTERIOR ────────────────────────────────────────
const leerEstadoAnterior = () => {
  try {
    if (fs.existsSync(ESTADO_FILE)) {
      return JSON.parse(fs.readFileSync(ESTADO_FILE, 'utf8'));
    }
  } catch(e) {}
  return null;
};

// ─── GUARDAR ESTADO ACTUAL ───────────────────────────────────────
const guardarEstado = (bancos) => {
  const estado = {
    _meta: {
      total:     bancos.length,
      timestamp: ahora(),
    }
  };
  bancos.forEach(b => { estado[b.nombre] = b.estatus; });
  fs.writeFileSync(ESTADO_FILE, JSON.stringify(estado, null, 2), 'utf8');
};

// ─── DETECTAR CAMBIOS ────────────────────────────────────────────
// Sin hardcode — el universo es lo que mande Banxico en cada corrida
const detectarCambios = (bancos, anterior) => {
  if (!anterior) return {
    seCayeron: [], seReconectaron: [],
    entidadesNuevas: [], entidadesRemovidas: [],
    hayCambios: false
  };

  const nombreAntes = Object.keys(anterior).filter(k => k !== '_meta');
  const nombreAhora = bancos.map(b => b.nombre);

  const seCayeron      = bancos.filter(b => anterior[b.nombre] === true  && b.estatus === false);
  const seReconectaron = bancos.filter(b => anterior[b.nombre] === false && b.estatus === true);
  const entidadesNuevas    = bancos.filter(b => anterior[b.nombre] === undefined);
  const entidadesRemovidas = nombreAntes
    .filter(n => !nombreAhora.includes(n))
    .map(n => ({ nombre: n }));

  const hayCambios = seCayeron.length > 0
                  || seReconectaron.length > 0
                  || entidadesNuevas.length > 0
                  || entidadesRemovidas.length > 0;

  return { seCayeron, seReconectaron, entidadesNuevas, entidadesRemovidas, hayCambios };
};

// ─── MAIN ────────────────────────────────────────────────────────
(async () => {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

  const timestamp = ahora();
  const hoy       = new Date();
  const DIA       = hoy.getFullYear()
                  + String(hoy.getMonth()+1).padStart(2,'0')
                  + String(hoy.getDate()).padStart(2,'0');
  const FECHA     = hoy.getFullYear()+'/'
                  + String(hoy.getMonth()+1).padStart(2,'0')+'/'
                  + String(hoy.getDate()).padStart(2,'0');

  console.log('');
  console.log(B+'  ╔══════════════════════════════════════════════════════╗'+X);
  console.log(B+'  ║   MONSPEI Banxico — Scraper  [Poka-Yoke v5]          ║'+X);
  console.log(B+'  ╚══════════════════════════════════════════════════════╝'+X);
  console.log('  Fecha    : ' + FECHA);
  console.log('  Capturado: ' + timestamp);
  console.log('');

  // ── 1. Leer estado anterior ──────────────────────────────────
  const estadoAnterior = leerEstadoAnterior();
  if (estadoAnterior) {
    const totalAntes = estadoAnterior._meta
      ? estadoAnterior._meta.total
      : Object.keys(estadoAnterior).filter(k => k !== '_meta').length;
    console.log('  Estado anterior : ' + V + 'cargado' + X
      + ' — ' + totalAntes + ' entidades'
      + ' (' + (estadoAnterior._meta ? estadoAnterior._meta.timestamp : 'sin fecha') + ')');
  } else {
    console.log('  Estado anterior : ' + AM + 'no existe (primera corrida)' + X);
  }
  console.log('');

  // ── 2. Consultar MONSPEI ─────────────────────────────────────
  let todos;
  try {
    process.stdout.write('  Consultando MONSPEI... ');
    const r = await axios.post(ENDPOINT, 'dia='+DIA, { headers: HEADERS, timeout: 30000 });
    todos   = r.data.info || [];
    console.log(V+'OK'+X+' — '+todos.length+' entidades recibidas de Banxico');
  } catch(e) {
    console.log(R+'ERROR: '+e.message+X);
    process.exit(1);
  }

  // ── 3. Clasificar entidades ──────────────────────────────────
  const bancos = todos.map(item => {
    const p      = item.periodos || [];
    const sorted = sortPeriodos(p);
    const u      = sorted[0] || {};
    return {
      nombre:      item.banco,
      estatus:     isConn(p),
      inicio:      u.inicio ? fmt(u.inicio) : 'N/A',
      fin:         u.fin    ? fmt(u.fin)    : 'N/A',
      diferencia:  u.fin
        ? (Math.round((Date.now() - u.fin) / 60000) + ' min')
        : 'N/A',
      numPeriodos: p.length,
    };
  });

  const conn = bancos.filter(b =>  b.estatus);
  const disc = bancos.filter(b => !b.estatus);

  // ── 4. Detectar cambios ──────────────────────────────────────
  const {
    seCayeron, seReconectaron,
    entidadesNuevas, entidadesRemovidas,
    hayCambios
  } = detectarCambios(bancos, estadoAnterior);

  // ── 5. Tabla de entidades ────────────────────────────────────
  console.log('');
  console.log('  '+'-'.repeat(80));
  console.log('  No.  Estado     Entidad                Inicio             Fin');
  console.log('  '+'-'.repeat(80));

  bancos.forEach((b, i) => {
    const num     = String(i+1).padStart(2,'0');
    const esNueva = estadoAnterior && estadoAnterior[b.nombre] === undefined;
    const estado  = b.estatus ? V+'[true ] '+X : R+'[false] '+X;
    const nom     = esNueva
      ? AM+B+b.nombre.padEnd(22)+X
      : b.nombre.padEnd(22);
    const extra   = b.numPeriodos > 1 ? ' ('+b.numPeriodos+'p)' : '';
    const tag     = esNueva ? AM+' ← NUEVA'+X : '';
    console.log('  '+num+'. '+estado+' '+nom+' '+b.inicio+'  '+b.fin+extra+tag);
  });

  console.log('  '+'-'.repeat(80));
  console.log('');
  console.log('  '+V+B+'Conectados   : '+conn.length+X);
  console.log('  '+R+B+'Desconectados: '+disc.length+X);
  console.log('  '+B+'Total SPEI   : '+bancos.length+' entidades'+X);

  // ── 6. Detalle de desconectados ──────────────────────────────
  if (disc.length > 0) {
    console.log('');
    console.log('  '+R+B+'DESCONECTADOS:'+X);
    disc.forEach(b => {
      console.log('  '+R+'  x '+b.nombre+X);
      console.log('      Inicio: '+b.inicio+'  Fin: '+b.fin);
    });
  }

  // ── 7. Resumen de cambios ────────────────────────────────────
  console.log('');
  console.log('  '+B+'─── CAMBIOS DETECTADOS '+'─'.repeat(46)+X);

  if (!estadoAnterior) {
    console.log('  '+AM+'  Primera corrida — sin estado anterior para comparar'+X);
  } else if (!hayCambios) {
    console.log('  '+V+'  Sin cambios — estado idéntico a la corrida anterior'+X);
  } else {
    if (entidadesNuevas.length > 0) {
      console.log('');
      console.log('  '+AM+B+'  NUEVA(S) ENTIDAD(ES) EN SPEI ('+entidadesNuevas.length+'):'+X);
      entidadesNuevas.forEach(b => {
        const est = b.estatus ? V+'[activa]'+X : R+'[inactiva]'+X;
        console.log('  '+AM+'  * '+b.nombre+X+' '+est);
      });
      const totalAntes = Object.keys(estadoAnterior).filter(k => k !== '_meta').length;
      console.log('  '+AM+'  Universo: '+totalAntes+' → '+bancos.length+' entidades'+X);
    }
    if (entidadesRemovidas.length > 0) {
      console.log('');
      console.log('  '+R+B+'  ENTIDAD(ES) REMOVIDA(S) DEL SPEI ('+entidadesRemovidas.length+'):'+X);
      entidadesRemovidas.forEach(b => console.log('  '+R+'  - '+b.nombre+X));
    }
    if (seCayeron.length > 0) {
      console.log('');
      console.log('  '+R+B+'  SE CAYERON ('+seCayeron.length+'):'+X);
      seCayeron.forEach(b => console.log('  '+R+'  x '+b.nombre+X));
    }
    if (seReconectaron.length > 0) {
      console.log('');
      console.log('  '+V+B+'  SE RECONECTARON ('+seReconectaron.length+'):'+X);
      seReconectaron.forEach(b => console.log('  '+V+'  + '+b.nombre+X));
    }
  }
  console.log('  '+B+'─'.repeat(68)+X);

  // ── 8. Guardar estado actual ─────────────────────────────────
  guardarEstado(bancos);

  // ── 9. Archivos CSV (Poka-Yoke) ──────────────────────────────
  const cab = 'Nombre,Estatus,Diferencia,Tiempo\n';

  // snapshot_inicial.txt — solo si no existe
  const rutaSnap = path.join(DIR, 'snapshot_inicial.txt');
  if (!fs.existsSync(rutaSnap)) {
    const lineas = [
      '================================================================',
      '  MONSPEI BANXICO — BASE DE DATOS INICIAL (REFERENCIA)',
      '  Fecha      : '+FECHA,
      '  Capturado  : '+timestamp,
      '  Total      : '+bancos.length,
      '  Conectados : '+conn.length,
      '  Desconect. : '+disc.length,
      '================================================================',
      '',
      '--- CONECTADOS ---',
      ...conn.map((b,i) => '  '+String(i+1).padStart(3,'0')+'. [true ] '+b.nombre),
      '',
      '--- DESCONECTADOS ---',
      ...disc.map((b,i) => '  '+String(i+1).padStart(3,'0')+'. [false] '+b.nombre),
      '',
      '--- FIN BASE INICIAL ---',
    ];
    fs.writeFileSync(rutaSnap, lineas.join('\n'), 'utf8');
    console.log('');
    console.log('  '+V+'Snapshot inicial guardado (primera vez)'+X);
  }

  // all.csv — POKA-YOKE: sobreescribe, siempre N filas exactas
  const rutaAll  = path.join(DIR, 'all.csv');
  const filasAll = bancos.map(b =>
    '"'+b.nombre.replace(/"/g,'""')+'",'
    +(b.estatus?'true':'false')+','
    +b.diferencia+','
    +timestamp
  );
  fs.writeFileSync(rutaAll, cab + filasAll.join('\n') + '\n', 'utf8');

  // desconectados.csv — POKA-YOKE: sobreescribe, solo rojos actuales
  const rutaDisc = path.join(DIR, 'desconectados.csv');
  if (disc.length > 0) {
    const filasDisc = disc.map(b =>
      '"'+b.nombre.replace(/"/g,'""')+'",false,'
      +b.diferencia+','+timestamp
    );
    fs.writeFileSync(rutaDisc, cab + filasDisc.join('\n') + '\n', 'utf8');
  } else {
    fs.writeFileSync(rutaDisc, cab, 'utf8');
  }

  // historial.csv — acumula todas las corridas
  const rutaHist = path.join(DIR, 'historial.csv');
  const esNuevoHist = !fs.existsSync(rutaHist);
  const filasHist = bancos.map(b =>
    '"'+b.nombre.replace(/"/g,'""')+'",'
    +(b.estatus?'true':'false')+','
    +b.diferencia+','
    +timestamp
  );
  fs.appendFileSync(rutaHist,
    (esNuevoHist ? cab : '') + filasHist.join('\n') + '\n', 'utf8');

  // cambios.csv — acumula CAIDA, RECONEXION, ENTIDAD_NUEVA, ENTIDAD_REMOVIDA
  if (hayCambios) {
    const rutaCambios = path.join(DIR, 'cambios.csv');
    const esNuevoCambios = !fs.existsSync(rutaCambios);
    const filasCambios = [
      ...seCayeron.map(b =>
        '"'+b.nombre+'","CAIDA","'+timestamp+'"'),
      ...seReconectaron.map(b =>
        '"'+b.nombre+'","RECONEXION","'+timestamp+'"'),
      ...entidadesNuevas.map(b =>
        '"'+b.nombre+'","ENTIDAD_NUEVA","'+timestamp+'"'),
      ...entidadesRemovidas.map(b =>
        '"'+b.nombre+'","ENTIDAD_REMOVIDA","'+timestamp+'"'),
    ];
    fs.appendFileSync(rutaCambios,
      (esNuevoCambios ? 'Banco,Evento,Tiempo\n' : '')
      + filasCambios.join('\n') + '\n', 'utf8');
  }

  // ── 10. Resumen final ────────────────────────────────────────
  console.log('');
  console.log('  Archivos en ./salidas/');
  console.log('  '+V+'snapshot_inicial.txt'+X+'  — referencia (solo 1a vez)');
  console.log('  '+V+B+'all.csv             '+X+'  — POKA-YOKE: '+bancos.length+' filas, estado actual');
  console.log('  '+V+B+'desconectados.csv   '+X+'  — POKA-YOKE: '+disc.length+' entidad(es) roja(s) ahora');
  console.log('  '+V+'historial.csv       '+X+'  — acumulado histórico completo');
  console.log('  '+V+'cambios.csv         '+X+'  — CAIDA / RECONEXION / ENTIDAD_NUEVA / ENTIDAD_REMOVIDA');
  console.log('  '+V+'estado_anterior.json'+X+'  — '+bancos.length+' entidades para próxima corrida');
  console.log('');
  process.exit(0);
})();
