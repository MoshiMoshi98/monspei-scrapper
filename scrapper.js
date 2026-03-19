const axios      = require('axios');
const dayjs      = require('dayjs');
const utc        = require('dayjs/plugin/utc');
const tzp        = require('dayjs/plugin/timezone');
const fs         = require('fs');
const path       = require('path');
const nodemailer = require('nodemailer');
dayjs.extend(utc);
dayjs.extend(tzp);

// ─── COLORES TERMINAL ───────────────────────────────────────────
const V  = '\x1b[32m';
const R  = '\x1b[31m';
const AM = '\x1b[33m';
const B  = '\x1b[1m';
const X  = '\x1b[0m';

// ─── CONFIG GENERAL ─────────────────────────────────────────────
const ZONA     = 'America/Mexico_City';
const ENDPOINT = 'https://www.banxico.org.mx/monspei/mostrarInformacion.do';
const DIR      = './salidas';
const MARGEN   = 5 * 60 * 1000;

// ─── CONFIG EMAIL ────────────────────────────────────────────────
// Pedir a TI de Banxico: host SMTP, puerto y si requiere TLS/SSL
// Pregunta exacta para TI:
//   "¿Cuál es el servidor SMTP para envío de correo saliente,
//    el puerto y si usa TLS o SSL?"
const EMAIL_CONFIG = {
  habilitado: true,
  smtp: {
    host:   'smtp.gmail.com',
    port:   587,
    secure: false,
    auth: {
      user: 'leocruz.contacto@gmail.com',
      pass: 'jjdnkoxivolykbtg',
    },
  },
  de:   'leocruz.contacto@gmail.com',
  para: 'angel.ortiz@banxico.org.mx, ralfaro@banxico.org.mx, tenoch.flores@banxico.org.mx, angel.garcia@banxico.org.mx, andres.velazquez@banxico.org.mx, nahieli.osorio@banxico.org.mx',
  // para enviar a varios: 'memo@banxico.org.mx, angel@banxico.org.mx'
};

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

const sortPeriodos = (p) => {
  if (!Array.isArray(p) || p.length === 0) return [];
  return [...p].sort((a, b) => b.fin - a.fin);
};

const isConn = (p) => {
  if (!Array.isArray(p) || p.length === 0) return false;
  const sorted = sortPeriodos(p);
  return (Date.now() - sorted[0].fin) <= MARGEN;
};

// ─── LEER / GUARDAR ESTADO ───────────────────────────────────────
const leerEstadoAnterior = () => {
  try {
    if (fs.existsSync(ESTADO_FILE))
      return JSON.parse(fs.readFileSync(ESTADO_FILE, 'utf8'));
  } catch(e) {}
  return null;
};

const guardarEstado = (bancos) => {
  const estado = { _meta: { total: bancos.length, timestamp: ahora() } };
  bancos.forEach(b => { estado[b.nombre] = b.estatus; });
  fs.writeFileSync(ESTADO_FILE, JSON.stringify(estado, null, 2), 'utf8');
};

// ─── DETECTAR CAMBIOS ────────────────────────────────────────────
const detectarCambios = (bancos, anterior) => {
  if (!anterior) return {
    seCayeron: [], seReconectaron: [],
    entidadesNuevas: [], entidadesRemovidas: [],
    hayCambios: false
  };

  const nombreAntes = Object.keys(anterior).filter(k => k !== '_meta');
  const nombreAhora = bancos.map(b => b.nombre);

  const seCayeron          = bancos.filter(b => anterior[b.nombre] === true  && b.estatus === false);
  const seReconectaron     = bancos.filter(b => anterior[b.nombre] === false && b.estatus === true);
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

// ─── ENVIAR EMAIL ────────────────────────────────────────────────
const enviarEmail = async (asunto, html, texto) => {
  if (!EMAIL_CONFIG.habilitado) {
    console.log('  Email: ' + AM + 'deshabilitado' + X);
    return;
  }
  try {
    process.stdout.write('  Enviando email... ');
    const transporter = nodemailer.createTransport(EMAIL_CONFIG.smtp);
    await transporter.sendMail({
      from:    EMAIL_CONFIG.de,
      to:      EMAIL_CONFIG.para,
      subject: asunto,
      text:    texto,
      html:    html,
    });
    console.log(V + 'OK → ' + EMAIL_CONFIG.para + X);
  } catch(e) {
    console.log(R + 'ERROR email: ' + e.message + X);
  }
};

// ─── CONSTRUIR EMAIL HTML ────────────────────────────────────────
const construirEmail = (conn, disc, seCayeron, seReconectaron,
                        entidadesNuevas, entidadesRemovidas, total, timestamp) => {

  const pct       = ((conn.length / total) * 100).toFixed(1);
  const colorPct  = conn.length === total ? '#27ae60' : conn.length >= total * 0.9 ? '#f39c12' : '#e74c3c';
  const tieneCambiosCriticos = seCayeron.length > 0 || entidadesNuevas.length > 0 || entidadesRemovidas.length > 0;

  // determinar asunto
  let asunto = '';
  if (entidadesNuevas.length > 0)
    asunto = `[MONSPEI] Nueva entidad financiera en SPEI — Total: ${total} — ${timestamp}`;
  else if (entidadesRemovidas.length > 0)
    asunto = `[MONSPEI] Entidad financiera removida del SPEI — ${timestamp}`;
  else if (seCayeron.length > 0 && seReconectaron.length > 0)
    asunto = `[MONSPEI] Cambios detectados: ${seCayeron.length} caída(s), ${seReconectaron.length} reconexión(es) — ${timestamp}`;
  else if (seCayeron.length > 0)
    asunto = `[MONSPEI] ${seCayeron.length} entidad(es) financiera(s) caída(s) — ${timestamp}`;
  else if (seReconectaron.length > 0)
    asunto = `[MONSPEI] ${seReconectaron.length} entidad(es) financiera(s) reconectada(s) — ${timestamp}`;

  // construir secciones de cambios en HTML
  let seccionCambios = '';

  if (entidadesNuevas.length > 0) {
    const filas = entidadesNuevas.map(b =>
      `<div style="border:1px solid #f5e0b0;border-left:3px solid #e67e22;border-radius:0 4px 4px 0;background:#fefaf4;padding:11px 16px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:6px;height:6px;border-radius:50%;background:#e67e22;"></div>
          <span style="font-size:13px;color:#7a4a10;font-weight:500;">${b.nombre}</span>
        </div>
        <span style="font-size:10px;color:#a05010;background:#fef0d8;border:1px solid #f5d090;padding:2px 8px;border-radius:3px;letter-spacing:0.5px;font-weight:500;">${b.estatus ? 'ACTIVA' : 'INACTIVA'}</span>
      </div>`
    ).join('');
    seccionCambios += `<p style="margin:0 0 8px;font-size:10px;font-weight:600;letter-spacing:1.2px;color:#c07020;text-transform:uppercase;">Nueva(s) entidad(es) en SPEI</p>${filas}`;
  }

  if (entidadesRemovidas.length > 0) {
    const filas = entidadesRemovidas.map(b =>
      `<div style="border:1px solid #f5c6c6;border-left:3px solid #e74c3c;border-radius:0 4px 4px 0;background:#fdf4f4;padding:11px 16px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:6px;height:6px;border-radius:50%;background:#e74c3c;"></div>
          <span style="font-size:13px;color:#7a2020;font-weight:500;">${b.nombre}</span>
        </div>
        <span style="font-size:10px;color:#c0392b;background:#fce8e8;border:1px solid #f5c6c6;padding:2px 8px;border-radius:3px;letter-spacing:0.5px;font-weight:500;">REMOVIDA</span>
      </div>`
    ).join('');
    seccionCambios += `<p style="margin:0 0 8px;font-size:10px;font-weight:600;letter-spacing:1.2px;color:#c0392b;text-transform:uppercase;">Entidad(es) removida(s) del SPEI</p>${filas}`;
  }

  if (seCayeron.length > 0) {
    const filas = seCayeron.map(b =>
      `<div style="border:1px solid #f5c6c6;border-left:3px solid #e74c3c;border-radius:0 4px 4px 0;background:#fdf4f4;padding:11px 16px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:6px;height:6px;border-radius:50%;background:#e74c3c;"></div>
          <span style="font-size:13px;color:#7a2020;font-weight:500;">${b.nombre}</span>
        </div>
        <span style="font-size:10px;color:#c0392b;background:#fce8e8;border:1px solid #f5c6c6;padding:2px 8px;border-radius:3px;letter-spacing:0.5px;font-weight:500;">CAÍDA</span>
      </div>`
    ).join('');
    seccionCambios += `<p style="margin:0 0 8px;font-size:10px;font-weight:600;letter-spacing:1.2px;color:#c0392b;text-transform:uppercase;">Se cayeron (${seCayeron.length})</p>${filas}`;
  }

  if (seReconectaron.length > 0) {
    const filas = seReconectaron.map(b =>
      `<div style="border:1px solid #c6e4d4;border-left:3px solid #27ae60;border-radius:0 4px 4px 0;background:#f4fdf7;padding:11px 16px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:6px;height:6px;border-radius:50%;background:#27ae60;"></div>
          <span style="font-size:13px;color:#1a5a30;font-weight:500;">${b.nombre}</span>
        </div>
        <span style="font-size:10px;color:#1a7a40;background:#e8faf0;border:1px solid #c6e4d4;padding:2px 8px;border-radius:3px;letter-spacing:0.5px;font-weight:500;">RECONEXIÓN</span>
      </div>`
    ).join('');
    seccionCambios += `<p style="margin:0 0 8px;font-size:10px;font-weight:600;letter-spacing:1.2px;color:#1a7a40;text-transform:uppercase;">Se reconectaron (${seReconectaron.length})</p>${filas}`;
  }

  // desconectados actuales
  let seccionDisc = '';
  if (disc.length > 0) {
    const filas = disc.map(b =>
      `<div style="border:1px solid #f5c6c6;border-left:3px solid #e74c3c;border-radius:0 4px 4px 0;background:#fdf4f4;padding:10px 16px;margin-bottom:5px;display:flex;align-items:center;gap:10px;">
        <div style="width:5px;height:5px;border-radius:50%;background:#e74c3c;"></div>
        <span style="font-size:12px;color:#7a2020;font-weight:500;">${b.nombre}</span>
      </div>`
    ).join('');
    seccionDisc = `<p style="margin:16px 0 8px;font-size:10px;font-weight:600;letter-spacing:1.2px;color:#9AACBF;text-transform:uppercase;">Total desconectados ahora (${disc.length})</p>${filas}`;
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#EDF2F7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#EDF2F7;padding:28px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:4px;overflow:hidden;border:1px solid #D0DAE8;">

        <tr><td style="background:#1a3a5c;height:4px;font-size:0;">&nbsp;</td></tr>

        <tr>
          <td style="background:#1a3a5c;padding:22px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <p style="margin:0 0 3px;font-size:10px;letter-spacing:2px;color:#7aadd4;text-transform:uppercase;font-weight:600;">Banco de México &middot; CIR</p>
                  <h1 style="margin:0;font-size:19px;font-weight:600;color:#ffffff;letter-spacing:-0.2px;">Monitor SPEI</h1>
                </td>
                <td align="right" style="vertical-align:middle;">
                  <span style="background:rgba(255,255,255,0.1);border-radius:3px;padding:5px 12px;font-size:11px;color:#b0cce4;border:1px solid rgba(255,255,255,0.15);">${timestamp}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:22px 32px 20px;background:#F7FAFD;border-bottom:1px solid #D0DAE8;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="23%" style="background:#ffffff;border:1px solid #D0DAE8;border-top:3px solid #27ae60;border-radius:0 0 4px 4px;padding:14px 16px;">
                  <p style="margin:0;font-size:26px;font-weight:600;color:#1a7a4a;line-height:1;">${conn.length}</p>
                  <p style="margin:6px 0 0;font-size:10px;letter-spacing:1px;color:#5a9a7a;text-transform:uppercase;font-weight:600;">Conectados</p>
                </td>
                <td width="3%"></td>
                <td width="23%" style="background:#ffffff;border:1px solid #D0DAE8;border-top:3px solid #e74c3c;border-radius:0 0 4px 4px;padding:14px 16px;">
                  <p style="margin:0;font-size:26px;font-weight:600;color:#c0392b;line-height:1;">${disc.length}</p>
                  <p style="margin:6px 0 0;font-size:10px;letter-spacing:1px;color:#c07070;text-transform:uppercase;font-weight:600;">Desconectados</p>
                </td>
                <td width="3%"></td>
                <td width="23%" style="background:#ffffff;border:1px solid #D0DAE8;border-top:3px solid #2E75B6;border-radius:0 0 4px 4px;padding:14px 16px;">
                  <p style="margin:0;font-size:26px;font-weight:600;color:#1a4a80;line-height:1;">${total}</p>
                  <p style="margin:6px 0 0;font-size:10px;letter-spacing:1px;color:#5a7aa0;text-transform:uppercase;font-weight:600;">Total SPEI</p>
                </td>
                <td width="3%"></td>
                <td width="23%" style="background:#ffffff;border:1px solid #D0DAE8;border-top:3px solid ${colorPct};border-radius:0 0 4px 4px;padding:14px 16px;">
                  <p style="margin:0;font-size:26px;font-weight:600;color:${colorPct};line-height:1;">${pct}%</p>
                  <p style="margin:6px 0 0;font-size:10px;letter-spacing:1px;color:#5a9a7a;text-transform:uppercase;font-weight:600;">Disponibilidad</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        ${(seccionCambios || seccionDisc) ? '<tr><td style="padding:20px 32px 24px;"><p style="margin:0 0 14px;font-size:10px;font-weight:600;letter-spacing:1.5px;color:#7A8CA3;text-transform:uppercase;">Cambios detectados</p>' + seccionCambios + seccionDisc + '</td></tr>' : ''}

        <tr>
          <td style="background:#F7FAFD;border-top:1px solid #D0DAE8;padding:14px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <p style="margin:0;font-size:10px;color:#9AACBF;line-height:1.7;">
                    <span style="color:#5a7a9a;font-weight:600;">MONSPEI v5</span> &nbsp;&middot;&nbsp; Centro de Inteligencia y Respuesta &nbsp;&middot;&nbsp; Direcci&oacute;n de Ciberseguridad &nbsp;&middot;&nbsp; Banxico<br>
                    Monitoreo autom&aacute;tico &middot; Actualizaci&oacute;n cada 30 minutos
                  </p>
                </td>
                <td align="right" style="vertical-align:middle;">
                  <div style="background:#1a3a5c;border-radius:3px;padding:4px 10px;font-size:10px;color:#7aadd4;white-space:nowrap;font-weight:600;letter-spacing:0.5px;">MONSPEI v5</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr><td style="background:#1a3a5c;height:3px;font-size:0;">&nbsp;</td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // versión texto plano
  const texto = [
    'MONSPEI — Monitor SPEI Banxico',
    timestamp,
    '',
    'Conectados   : ' + conn.length,
    'Desconectados: ' + disc.length,
    'Disponibilidad: ' + pct + '%',
    'Total SPEI   : ' + total + ' entidades',
    '',
    seCayeron.length > 0      ? 'SE CAYERON:\n' + seCayeron.map(b=>'  x '+b.nombre).join('\n') : '',
    seReconectaron.length > 0 ? 'SE RECONECTARON:\n' + seReconectaron.map(b=>'  + '+b.nombre).join('\n') : '',
    entidadesNuevas.length > 0? 'ENTIDADES NUEVAS:\n' + entidadesNuevas.map(b=>'  * '+b.nombre).join('\n') : '',
    disc.length > 0           ? 'TOTAL DESCONECTADOS:\n' + disc.map(b=>'  x '+b.nombre).join('\n') : '',
  ].filter(Boolean).join('\n');

  return { asunto, html, texto };
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
  console.log('  Email    : ' + (EMAIL_CONFIG.habilitado ? V+'ACTIVO → '+EMAIL_CONFIG.para+X : AM+'deshabilitado'+X));
  console.log('');

  // ── 1. Estado anterior ───────────────────────────────────────
  const estadoAnterior = leerEstadoAnterior();
  if (estadoAnterior) {
    const totalAntes = estadoAnterior._meta ? estadoAnterior._meta.total
      : Object.keys(estadoAnterior).filter(k => k !== '_meta').length;
    console.log('  Estado anterior : ' + V+'cargado'+X
      + ' — ' + totalAntes + ' entidades'
      + ' (' + (estadoAnterior._meta ? estadoAnterior._meta.timestamp : 'sin fecha') + ')');
  } else {
    console.log('  Estado anterior : ' + AM+'no existe (primera corrida)'+X);
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

  // ── 3. Clasificar ────────────────────────────────────────────
  const bancos = todos.map(item => {
    const p      = item.periodos || [];
    const sorted = sortPeriodos(p);
    const u      = sorted[0] || {};
    return {
      nombre:      item.banco,
      estatus:     isConn(p),
      inicio:      u.inicio ? fmt(u.inicio) : 'N/A',
      fin:         u.fin    ? fmt(u.fin)    : 'N/A',
      diferencia:  u.fin ? (Math.round((Date.now()-u.fin)/60000)+' min') : 'N/A',
      numPeriodos: p.length,
    };
  });

  const conn = bancos.filter(b =>  b.estatus);
  const disc = bancos.filter(b => !b.estatus);

  // ── 4. Detectar cambios ──────────────────────────────────────
  const { seCayeron, seReconectaron, entidadesNuevas, entidadesRemovidas, hayCambios }
    = detectarCambios(bancos, estadoAnterior);

  // ── 5. Tabla terminal ────────────────────────────────────────
  console.log('');
  console.log('  '+'-'.repeat(80));
  console.log('  No.  Estado     Entidad                Inicio             Fin');
  console.log('  '+'-'.repeat(80));

  bancos.forEach((b, i) => {
    const num     = String(i+1).padStart(2,'0');
    const esNueva = estadoAnterior && estadoAnterior[b.nombre] === undefined;
    const estado  = b.estatus ? V+'[true ] '+X : R+'[false] '+X;
    const nom     = esNueva ? AM+B+b.nombre.padEnd(22)+X : b.nombre.padEnd(22);
    const extra   = b.numPeriodos > 1 ? ' ('+b.numPeriodos+'p)' : '';
    const tag     = esNueva ? AM+' ← NUEVA'+X : '';
    console.log('  '+num+'. '+estado+' '+nom+' '+b.inicio+'  '+b.fin+extra+tag);
  });

  console.log('  '+'-'.repeat(80));
  console.log('');
  console.log('  '+V+B+'Conectados   : '+conn.length+X);
  console.log('  '+R+B+'Desconectados: '+disc.length+X);
  console.log('  '+B+'Total SPEI   : '+bancos.length+' entidades'+X);

  if (disc.length > 0) {
    console.log('');
    console.log('  '+R+B+'DESCONECTADOS:'+X);
    disc.forEach(b => {
      console.log('  '+R+'  x '+b.nombre+X);
      console.log('      Inicio: '+b.inicio+'  Fin: '+b.fin);
    });
  }

  // ── 6. Cambios terminal ──────────────────────────────────────
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
      const totalAntes = Object.keys(estadoAnterior).filter(k=>k!=='_meta').length;
      console.log('  '+AM+'  Universo: '+totalAntes+' → '+bancos.length+' entidades'+X);
    }
    if (entidadesRemovidas.length > 0) {
      console.log('');
      console.log('  '+R+B+'  ENTIDAD(ES) REMOVIDA(S) ('+entidadesRemovidas.length+'):'+X);
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

  // ── 7. Enviar email si hay cambios ───────────────────────────
  console.log('');
  if (!estadoAnterior) {
    console.log('  Email: '+AM+'omitido (primera corrida)'+X);
  } else if (!hayCambios) {
    console.log('  Email: '+V+'omitido (sin cambios)'+X);
  } else {
    const { asunto, html, texto } = construirEmail(
      conn, disc, seCayeron, seReconectaron,
      entidadesNuevas, entidadesRemovidas,
      bancos.length, timestamp
    );
    await enviarEmail(asunto, html, texto);
  }

  // ── 8. Guardar estado ────────────────────────────────────────
  guardarEstado(bancos);

  // ── 9. CSV Poka-Yoke ─────────────────────────────────────────
  const cab = 'Nombre,Estatus,Diferencia,Tiempo\n';

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
      '', '--- CONECTADOS ---',
      ...conn.map((b,i)=>'  '+String(i+1).padStart(3,'0')+'. [true ] '+b.nombre),
      '', '--- DESCONECTADOS ---',
      ...disc.map((b,i)=>'  '+String(i+1).padStart(3,'0')+'. [false] '+b.nombre),
      '', '--- FIN BASE INICIAL ---',
    ];
    fs.writeFileSync(rutaSnap, lineas.join('\n'), 'utf8');
    console.log('');
    console.log('  '+V+'Snapshot inicial guardado (primera vez)'+X);
  }

  const rutaAll  = path.join(DIR, 'all.csv');
  fs.writeFileSync(rutaAll, cab + bancos.map(b=>
    '"'+b.nombre.replace(/"/g,'""')+'",'+(b.estatus?'true':'false')+','+b.diferencia+','+timestamp
  ).join('\n')+'\n', 'utf8');

  const rutaDisc = path.join(DIR, 'desconectados.csv');
  fs.writeFileSync(rutaDisc, disc.length > 0
    ? cab + disc.map(b=>'"'+b.nombre.replace(/"/g,'""')+'",false,'+b.diferencia+','+timestamp).join('\n')+'\n'
    : cab, 'utf8');

  const rutaHist = path.join(DIR, 'historial.csv');
  const esNuevoHist = !fs.existsSync(rutaHist);
  fs.appendFileSync(rutaHist,
    (esNuevoHist ? cab : '') + bancos.map(b=>
      '"'+b.nombre.replace(/"/g,'""')+'",'+(b.estatus?'true':'false')+','+b.diferencia+','+timestamp
    ).join('\n')+'\n', 'utf8');

  if (hayCambios) {
    const rutaCambios = path.join(DIR, 'cambios.csv');
    const esNuevoCambios = !fs.existsSync(rutaCambios);
    const filas = [
      ...seCayeron.map(b=>'"'+b.nombre+'","CAIDA","'+timestamp+'"'),
      ...seReconectaron.map(b=>'"'+b.nombre+'","RECONEXION","'+timestamp+'"'),
      ...entidadesNuevas.map(b=>'"'+b.nombre+'","ENTIDAD_NUEVA","'+timestamp+'"'),
      ...entidadesRemovidas.map(b=>'"'+b.nombre+'","ENTIDAD_REMOVIDA","'+timestamp+'"'),
    ];
    fs.appendFileSync(rutaCambios,
      (esNuevoCambios ? 'Banco,Evento,Tiempo\n' : '') + filas.join('\n')+'\n', 'utf8');
  }

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
