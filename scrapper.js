const axios = require('axios');
const dayjs = require('dayjs');
const utc   = require('dayjs/plugin/utc');
const tzp   = require('dayjs/plugin/timezone');
const fs    = require('fs');
const path  = require('path');
dayjs.extend(utc);
dayjs.extend(tzp);

const V = '\x1b[32m';
const R = '\x1b[31m';
const B = '\x1b[1m';
const X = '\x1b[0m';

const ZONA     = 'America/Mexico_City';
const ENDPOINT = 'https://www.banxico.org.mx/monspei/mostrarInformacion.do';
const DIR      = './salidas';
const MARGEN   = 5 * 60 * 1000;

const HEADERS = {
  'User-Agent':       'Mozilla/5.0 Chrome/121.0.0.0 Safari/537.36',
  'Accept':           'application/json, text/javascript; q=0.01',
  'Content-Type':     'application/x-www-form-urlencoded; charset=UTF-8',
  'X-Requested-With': 'XMLHttpRequest',
  'Origin':           'https://www.banxico.org.mx',
  'Referer':          'https://www.banxico.org.mx/monspei/',
};

const fmt    = ts  => dayjs(ts).tz(ZONA).format('DD/MM/YY HH:mm:ss');
const ahora  = ()  => dayjs().tz(ZONA).format('DD/MM/YYYY HH:mm:ss');
const isConn = (p) => {
  if (!Array.isArray(p) || p.length === 0) return false;
  return (Date.now() - p.slice(-1)[0].fin) <= MARGEN;
};

(async () => {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  const timestamp = ahora();
  const hoy       = new Date();
  const DIA       = hoy.getFullYear()+String(hoy.getMonth()+1).padStart(2,'0')+String(hoy.getDate()).padStart(2,'0');
  const FECHA     = hoy.getFullYear()+'/'+String(hoy.getMonth()+1).padStart(2,'0')+'/'+String(hoy.getDate()).padStart(2,'0');

  console.log('');
  console.log(B+'  MONSPEI Banxico — Scraper'+X);
  console.log('  Fecha    : ' + FECHA);
  console.log('  Capturado: ' + timestamp);
  console.log('');

  let todos;
  try {
    process.stdout.write('  Consultando MONSPEI... ');
    const r = await axios.post(ENDPOINT, 'dia='+DIA, { headers: HEADERS, timeout: 30000 });
    todos   = r.data.info || [];
    console.log(V+'OK'+X+' — '+todos.length+' bancos recibidos');
  } catch(e) {
    console.log(R+'ERROR: '+e.message+X);
    process.exit(1);
  }

  const bancos = todos.map(item => {
    const p = item.periodos || [];
    const u = p.slice(-1)[0] || {};
    return {
      nombre:     item.banco,
      estatus:    isConn(p),
      inicio:     u.inicio ? fmt(u.inicio) : 'N/A',
      fin:        u.fin    ? fmt(u.fin)    : 'N/A',
      diferencia: u.fin ? (Math.round((Date.now() - u.fin) / 60000) + ' min') : 'N/A',
    };
  });

  const conn = bancos.filter(b =>  b.estatus);
  const disc = bancos.filter(b => !b.estatus);

  console.log('');
  console.log('  '+'-'.repeat(76));
  console.log('  No.  Estado     Banco                  Inicio             Fin');
  console.log('  '+'-'.repeat(76));
  bancos.forEach((b, i) => {
    const estado = b.estatus ? V+'[true ] '+X : R+'[false] '+X;
    console.log('  '+String(i+1).padStart(2,'0')+'. '+estado+' '+b.nombre.padEnd(22)+' '+b.inicio+'  '+b.fin);
  });
  console.log('  '+'-'.repeat(76));
  console.log('');
  console.log('  '+V+B+'Conectados   : '+conn.length+X);
  console.log('  '+R+B+'Desconectados: '+disc.length+X);

  if (disc.length > 0) {
    console.log('');
    console.log('  '+R+B+'DESCONECTADOS:'+X);
    disc.forEach(b => {
      console.log('  '+R+'  x '+b.nombre+X);
      console.log('      Inicio: '+b.inicio+'  Fin: '+b.fin);
    });
  }

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
      '--- CONECTADOS (true / verde) ---',
      ...conn.map((b,i) => '  '+String(i+1).padStart(3,'0')+'. [true ] '+b.nombre),
      '',
      '--- DESCONECTADOS (false / rojo) ---',
      ...disc.map((b,i) => '  '+String(i+1).padStart(3,'0')+'. [false] '+b.nombre),
      '',
      '--- FIN BASE INICIAL ---',
    ];
    fs.writeFileSync(rutaSnap, lineas.join('\n'), 'utf8');
    console.log('');
    console.log('  '+V+'Snapshot inicial guardado'+X);
  }

  const cab    = 'Nombre,Estatus,Diferencia,Tiempo\n';
  const rutaAll = path.join(DIR, 'all.csv');
  fs.appendFileSync(rutaAll, (!fs.existsSync(rutaAll) ? cab : '') + bancos.map(b => '"'+b.nombre+'",'+( b.estatus?'true':'false')+','+b.diferencia+','+timestamp).join('\n') + '\n', 'utf8');

  const rutaDisc = path.join(DIR, 'desconectados.csv');
  if (disc.length > 0) {
    fs.appendFileSync(rutaDisc, (!fs.existsSync(rutaDisc) ? cab : '') + disc.map(b => '"'+b.nombre+'",false,'+b.diferencia+','+timestamp).join('\n') + '\n', 'utf8');
  }

  console.log('');
  console.log('  Archivos en ./salidas/');
  console.log('  '+V+'snapshot_inicial.txt / all.csv / desconectados.csv'+X);
  console.log('');
  process.exit(0);
})();
