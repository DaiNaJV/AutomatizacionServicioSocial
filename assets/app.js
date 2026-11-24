/* NexoTec · Servicio Social en Línea
   Versión estática para GitHub Pages: no necesita PHP ni MySQL.
   Los datos se guardan en el navegador (localStorage) y los archivos en IndexedDB.
   Cada navegador tiene su propia copia de los datos de demostración. */
(function(){
'use strict';

const DB_KEY = 'nexotec_ss_db_v1';
const SESSION_KEY = 'nexotec_ss_session';
const REQUIRED_HOURS = 500;
const MAX_FILE = 5 * 1024 * 1024;
const ALLOWED_EXT = ['pdf','jpg','jpeg','png'];

/* ---------- Catálogos ---------- */
const DOC_TYPES = {
  solicitud:'Solicitud', carta_compromiso:'Carta compromiso', carta_aceptacion:'Carta de aceptación',
  plan_trabajo:'Plan de trabajo', reporte_bimestral:'Reporte bimestral', evaluacion:'Evaluación',
  reporte_final:'Reporte final', carta_terminacion:'Carta de terminación', otro:'Otro'
};
const EXP_STATUS = {
  pre_registro:'Pre-registro', en_proceso:'En proceso', pendiente_revision:'Pendiente de revisión',
  observado:'Observado', completo:'Completo', liberado:'Liberado', baja:'Baja'
};
const DOC_STATUS = { recibido:'Recibido', validado:'Validado', observado:'Observado', rechazado:'Rechazado', aprobado:'Aprobado' };
const REPORT_STATUS = { borrador:'Borrador', enviado:'Enviado', evaluado:'Evaluado', observado:'Observado' };
const TONE = {
  pre_registro:'neutral', en_proceso:'ink', pendiente_revision:'warn', observado:'warn', completo:'ok',
  liberado:'ok', baja:'bad', recibido:'neutral', validado:'ok', aprobado:'ok', rechazado:'bad',
  enviado:'ink', evaluado:'ok', borrador:'neutral'
};
const ROLE_LABEL = { admin:'Administración', student:'Estudiante', supervisor:'Supervisión' };
const EDITABLE_DOC = ['recibido','observado','rechazado'];

/* ---------- Utilidades ---------- */
const $ = (s, el=document) => el.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => new Date().toISOString().slice(0,10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10); };
const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth()+n); return x.toISOString().slice(0,10); };
const nowISO = () => new Date().toISOString();
function fmtDate(v){
  if(!v) return 'Pendiente';
  const d = v.length === 10 ? new Date(v + 'T12:00:00') : new Date(v);
  return isNaN(d) ? v : d.toLocaleDateString('es-MX', {day:'numeric', month:'short', year:'numeric'});
}
function fmtDateTime(v){
  if(!v) return '—';
  const d = new Date(v);
  return d.toLocaleString('es-MX', {day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'});
}
function fmtSize(b){ if(!b) return ''; return b < 1024*1024 ? Math.max(1,Math.round(b/1024))+' KB' : (b/1024/1024).toFixed(1)+' MB'; }
const rot = id => ((id * 37) % 7 - 3) * 0.7;
function stamp(status, big){
  const label = EXP_STATUS[status] || DOC_STATUS[status] || REPORT_STATUS[status] || status;
  return `<span class="stamp ${TONE[status]||'neutral'}${big?' big':''}" style="--rot:${rot(label.length)}deg">${esc(label)}</span>`;
}
function options(map, selected){
  return Object.entries(map).map(([k,v]) => `<option value="${k}"${k===selected?' selected':''}>${esc(v)}</option>`).join('');
}
const firstName = n => String(n||'').split(' ')[0];
const plural = (n, one, many) => `${n} ${n===1?one:many}`;

async function hashPw(pw){
  if(window.crypto && crypto.subtle){
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('nexotec:' + pw));
    return 'sha256:' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }
  return 'plain:' + pw;
}

/* ---------- Almacén de archivos (IndexedDB) ---------- */
const Files = {
  _db:null,
  open(){
    if(this._db) return this._db;
    this._db = new Promise((res, rej) => {
      const r = indexedDB.open('nexotec_ss_files', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this._db;
  },
  async tx(mode, fn){
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('files', mode); const store = t.objectStore('files');
      const req = fn(store);
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  },
  put(key, blob){ return this.tx('readwrite', s => s.put(blob, key)); },
  get(key){ return this.tx('readonly', s => s.get(key)); },
  del(key){ return this.tx('readwrite', s => s.delete(key)); },
  clear(){ return this.tx('readwrite', s => s.clear()); }
};

/* ---------- Base de datos local ---------- */
let db = null;
function save(){ localStorage.setItem(DB_KEY, JSON.stringify(db)); }
function nextId(table){ db.seq[table] = (db.seq[table]||0) + 1; return db.seq[table]; }

async function seed(){
  const pass = await hashPw('password');
  const t = today();
  const ago = (days, h=10) => { const d = new Date(); d.setDate(d.getDate()-days); d.setHours(h, 15, 0, 0); return d.toISOString(); };
  db = {
    version:1,
    seq:{ users:5, students:3, programs:3, expedientes:3, documents:4, reports:1, events:7 },
    users:[
      {id:1, name:'Administración NexoTec', email:'admin@demo.local', pass, role:'admin', active:true},
      {id:2, name:'Ana Lucía Rodríguez', email:'alumno@demo.local', pass, role:'student', active:true},
      {id:3, name:'Mtro. Ernesto Salazar', email:'supervisor@demo.local', pass, role:'supervisor', active:true},
      {id:4, name:'Diego Hernández Ruiz', email:'diego@demo.local', pass, role:'student', active:true},
      {id:5, name:'Mariana Torres Vega', email:'mariana@demo.local', pass, role:'student', active:true}
    ],
    students:[
      {id:1, userId:2, control:'22010001', career:'Ingeniería en Sistemas Computacionales', semester:8, credits:78, created:ago(60)},
      {id:2, userId:4, control:'22010045', career:'Ingeniería Industrial', semester:7, credits:72, created:ago(40)},
      {id:3, userId:5, control:'21010112', career:'Ingeniería en Gestión Empresarial', semester:9, credits:91, created:ago(200)}
    ],
    programs:[
      {id:1, name:'Programa de apoyo comunitario', receiver:'Ayuntamiento de Matehuala'},
      {id:2, name:'AlfabetizaTec', receiver:'Programa institucional'},
      {id:3, name:'Apoyo en laboratorio de cómputo', receiver:'Departamento de Sistemas y Computación'}
    ],
    expedientes:[
      {id:1, studentId:1, programId:1, status:'en_proceso', start:addDays(t,-45), end:addMonths(addDays(t,-45),6), induction:true, planDue:addDays(t,10), hours:120, notes:'', updated:ago(2)},
      {id:2, studentId:2, programId:2, status:'pre_registro', start:null, end:null, induction:false, planDue:null, hours:0, notes:'', updated:ago(5)},
      {id:3, studentId:3, programId:3, status:'liberado', start:addMonths(t,-8), end:addMonths(t,-1), induction:true, planDue:null, hours:500, notes:'Constancia entregada.', updated:ago(20)}
    ],
    documents:[
      {id:1, expId:1, type:'solicitud', name:'solicitud_servicio_social.pdf', fileKey:null, size:184000, folio:'SS-2026-014', period:'', date:addDays(t,-50), status:'validado', notes:'Datos completos.', uploadedBy:2, reviewedBy:3, created:ago(48), reviewed:ago(46)},
      {id:2, expId:1, type:'carta_aceptacion', name:'carta_aceptacion_ayuntamiento.pdf', fileKey:null, size:251000, folio:'SS-2026-015', period:'', date:addDays(t,-46), status:'aprobado', notes:'Aprobado por Servicio Social.', uploadedBy:2, reviewedBy:1, created:ago(45), reviewed:ago(44)},
      {id:3, expId:1, type:'reporte_bimestral', name:'reporte_bimestre_1.pdf', fileKey:null, size:322000, folio:'SS-2026-031', period:'Bimestre 1', date:addDays(t,-3), status:'observado', notes:'Falta la firma del responsable del programa en la hoja 2.', uploadedBy:2, reviewedBy:3, created:ago(3), reviewed:ago(2)},
      {id:4, expId:2, type:'solicitud', name:'solicitud_diego.pdf', fileKey:null, size:140000, folio:'SS-2026-040', period:'', date:addDays(t,-1), status:'recibido', notes:'Pendiente de validación administrativa.', uploadedBy:4, reviewedBy:null, created:ago(1), reviewed:null}
    ],
    reports:[
      {id:1, expId:1, period:1, activities:'Captura del padrón de beneficiarios y apoyo en jornadas de registro.', hours:120, status:'enviado', due:addDays(t,-2), submitted:ago(3)}
    ],
    events:[
      {id:1, expId:3, userId:1, type:'estado_expediente', desc:'Expediente de Mariana Torres marcado como liberado', created:ago(20)},
      {id:2, expId:1, userId:2, type:'carga_documento', desc:'Documento cargado: solicitud_servicio_social.pdf', created:ago(48)},
      {id:3, expId:1, userId:3, type:'revision_documento', desc:'Solicitud de Ana Lucía Rodríguez validada', created:ago(46)},
      {id:4, expId:1, userId:1, type:'revision_documento', desc:'Carta de aceptación de Ana Lucía Rodríguez aprobada', created:ago(44)},
      {id:5, expId:1, userId:2, type:'reporte_enviado', desc:'Reporte bimestral 1 enviado (120 h)', created:ago(3)},
      {id:6, expId:1, userId:3, type:'revision_documento', desc:'Reporte bimestral 1 de Ana Lucía Rodríguez observado: falta firma', created:ago(2)},
      {id:7, expId:2, userId:4, type:'carga_documento', desc:'Documento cargado: solicitud_diego.pdf', created:ago(1)}
    ]
  };
  save();
}

async function loadDb(){
  try{ db = JSON.parse(localStorage.getItem(DB_KEY)); }catch(e){ db = null; }
  if(!db || db.version !== 1) await seed();
}

/* ---------- Consultas ---------- */
const byId = (table, id) => db[table].find(r => r.id === Number(id));
const userById = id => byId('users', id);
const studentOfUser = uid => db.students.find(s => s.userId === uid);
const expOfStudent = sid => db.expedientes.filter(e => e.studentId === sid).sort((a,b) => b.id - a.id)[0];
const docsOfExp = eid => db.documents.filter(d => d.expId === eid).sort((a,b) => b.created.localeCompare(a.created));
const reportsOfExp = eid => db.reports.filter(r => r.expId === eid).sort((a,b) => a.period - b.period);
function studentNameOfExp(exp){ const s = byId('students', exp.studentId); const u = s && userById(s.userId); return u ? u.name : 'Sin usuario'; }
const pendingDocs = () => db.documents.filter(d => d.status === 'recibido' || d.status === 'observado');

function logEvent(type, desc, expId=null){
  db.events.push({id:nextId('events'), expId, userId:me()?.id ?? null, type, desc, created:nowISO()});
}

/* ---------- Sesión ---------- */
function me(){ const id = Number(sessionStorage.getItem(SESSION_KEY)); return id ? userById(id) : null; }
function can(...roles){ const u = me(); return !!u && roles.includes(u.role); }

/* ---------- Avisos ---------- */
function toast(msg, type='success'){
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'success' ? '' : type);
  el.textContent = msg;
  const box = $('#toasts'); while(box.children.length >= 3) box.firstChild.remove();
  box.appendChild(el);
  setTimeout(() => el.remove(), 4800);
}

/* ---------- Rutas ---------- */
const ROUTES = {
  inicio:{ label:'Inicio', roles:['admin','student','supervisor'], render:pageHome },
  'mi-servicio':{ label:'Mi servicio social', roles:['student'], render:pageMyFile },
  estudiantes:{ label:'Estudiantes', roles:['admin'], render:pageStudents },
  expedientes:{ label:'Expedientes', roles:['admin','supervisor'], render:pageFiles },
  revision:{ label:'Revisión de documentos', roles:['admin','supervisor'], render:pageReview, count:() => pendingDocs().length },
  bitacora:{ label:'Bitácora', roles:['admin','student','supervisor'], render:pageLog }
};
const routeName = () => (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'inicio';
const go = r => { if(location.hash === '#/' + r) render(); else location.hash = '#/' + r; };

let ui = { reviewFilter:'pendientes' };

function render(){
  const u = me();
  const app = $('#app');
  if(!u){ app.innerHTML = pageLogin(); $('#email')?.focus(); return; }
  let r = routeName();
  if(r === 'login' || !ROUTES[r] || !ROUTES[r].roles.includes(u.role)) r = 'inicio';
  const route = ROUTES[r];
  const tabs = Object.entries(ROUTES).filter(([,v]) => v.roles.includes(u.role)).map(([k,v]) => {
    const n = v.count ? v.count() : 0;
    return `<a class="tab" href="#/${k}"${k===r?' aria-current="page"':''}>${esc(v.label)}${n?`<span class="count" aria-label="${n} pendientes">${n}</span>`:''}</a>`;
  }).join('');
  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#/inicio" aria-label="Ir al inicio">
        <span class="seal" aria-hidden="true">NT</span>
        <span><span class="brand-name">NexoTec</span><span class="brand-sub" style="display:block">Servicio social, TecNM Campus Matehuala</span></span>
      </a>
      <div class="who">
        <div class="who-text"><b>${esc(u.name)}</b><small>${ROLE_LABEL[u.role]}</small></div>
        <button class="btn small" data-click="logout">Cerrar sesión</button>
      </div>
    </header>
    <nav class="tabs" aria-label="Secciones">${tabs}</nav>
    <main class="folder-body"><div class="folder-wrap"><div class="sheet">${route.render(u)}</div></div></main>
    <footer class="foot">
      <span>Prototipo académico 2026. Datos ficticios; no está conectado al SII ni emite constancias oficiales.</span>
      <button data-click="reset">Restablecer datos de demostración</button>
    </footer>`;
  document.title = `${route.label} | NexoTec Servicio Social`;
}

/* ---------- Página: acceso ---------- */
function pageLogin(){
  const demo = [
    ['alumno@demo.local','Estudiante','Ana Lucía, expediente en proceso'],
    ['supervisor@demo.local','Supervisión','Revisa y observa documentos'],
    ['admin@demo.local','Administración','Registra estudiantes y libera expedientes']
  ];
  return `
  <div class="login">
    <section class="login-hero">
      <div class="brand"><span class="seal" aria-hidden="true">NT</span><div><div class="brand-name">NexoTec</div><div class="brand-sub">Servicio social, TecNM Campus Matehuala</div></div></div>
      <div>
        <h1>Tu servicio social, sin vueltas a ventanilla.</h1>
        <p class="lead">Entrega tus documentos, registra tus horas y entérate en cuanto revisen tu expediente. Todo en un mismo lugar.</p>
      </div>
      <div class="folder" aria-hidden="true">
        <div class="folder-back"></div>
        <div class="folder-sheet"><div class="line" style="width:60%"></div><div class="line" style="width:85%"></div><div class="line" style="width:70%"></div></div>
        <div class="folder-front">
          <div class="folder-label">Expediente<b>22010001</b>Servicio social 2026</div>
        </div>
        <span class="stamp hero">En línea</span>
      </div>
    </section>
    <section class="login-panel">
      <div class="login-card">
        <h2>Inicia sesión</h2>
        <p>Usa el correo con el que te registró la oficina de Servicio Social.</p>
        <form class="form" data-action="login" novalidate>
          <label class="field">Correo electrónico<input id="email" type="email" name="email" autocomplete="username" placeholder="usuario@ejemplo.com" required></label>
          <label class="field">Contraseña<input id="password" type="password" name="password" autocomplete="current-password" required></label>
          <button class="btn primary full">Entrar al portal</button>
        </form>
        <div class="demo">
          <h3>Cuentas de demostración</h3>
          <p>Toca una para llenar el formulario. La contraseña de todas es <b>password</b>.</p>
          <div class="demo-list">
            ${demo.map(([e,r,d]) => `<button type="button" class="demo-btn" data-click="fill" data-email="${e}"><span><b>${r}</b><small>${d}</small></span><small>${e}</small></button>`).join('')}
          </div>
        </div>
        <p class="fine">Prototipo académico con datos ficticios. La información se guarda solo en este navegador.</p>
      </div>
    </section>
  </div>`;
}

/* ---------- Página: inicio ---------- */
function pageHome(u){ return u.role === 'student' ? homeStudent(u) : homeStaff(u); }

function hoursRuler(hours){
  const pct = Math.min(100, (hours / REQUIRED_HOURS) * 100);
  return `<div class="ruler" role="img" aria-label="${hours} de ${REQUIRED_HOURS} horas">
    <div class="ruler-top"><b>${hours} <small>de ${REQUIRED_HOURS} horas</small></b><span>${Math.round(pct)}%</span></div>
    <div class="ruler-bar"><div class="ruler-fill" style="width:${pct}%"></div></div>
    <div class="ruler-scale"><span>0</span><span>100</span><span>200</span><span>300</span><span>400</span><span>500</span></div>
  </div>`;
}

function stagesOf(exp){
  const docs = exp ? docsOfExp(exp.id) : [];
  const ok = t => docs.some(d => d.type === t && ['validado','aprobado'].includes(d.status));
  const startDone = !!exp && exp.induction && (ok('carta_aceptacion') || ok('solicitud'));
  const devDone = !!exp && exp.hours >= REQUIRED_HOURS;
  const closeDone = !!exp && exp.status === 'liberado';
  const list = [
    {t:'Inicio', p:'Verifica el 70% de créditos, toma la inducción, elige programa y entrega tus documentos iniciales.', done:startDone},
    {t:'Desarrollo', p:'Realiza tus actividades, registra horas y entrega los tres reportes bimestrales con su evaluación.', done:devDone},
    {t:'Cierre', p:'Entrega el reporte final y la carta de terminación. Servicio Social revisa y gestiona tu liberación.', done:closeDone}
  ];
  const cur = list.findIndex(s => !s.done);
  return `<div class="stages">${list.map((s,i) => `
    <div class="stage ${s.done?'done':''} ${i===cur?'now':''}">
      <span class="n">${s.done?'✓':i+1}</span>
      <span class="state">${s.done?'Completada':i===cur?'Etapa actual':'Pendiente'}</span>
      <h3>${s.t}</h3><p>${s.p}</p>
    </div>`).join('')}</div>`;
}

function nextSteps(exp){
  if(!exp) return ['Acude a la oficina de Servicio Social para abrir tu expediente.'];
  const docs = docsOfExp(exp.id); const reps = reportsOfExp(exp.id); const out = [];
  docs.filter(d => d.status === 'observado' || d.status === 'rechazado').forEach(d =>
    out.push(`Corrige <b>${esc(DOC_TYPES[d.type])}</b>: ${esc(d.notes || 'revisa las observaciones')}`));
  if(!exp.induction) out.push('Registra tu asistencia a la inducción.');
  if(!docs.some(d => d.type === 'plan_trabajo')) out.push(`Entrega tu plan de trabajo${exp.planDue?` antes del <b>${fmtDate(exp.planDue)}</b>`:''}.`);
  const nextRep = [1,2,3].find(n => !reps.some(r => r.period === n));
  if(nextRep && exp.status !== 'liberado') out.push(`Envía tu reporte del bimestre ${nextRep}.`);
  if(exp.status === 'liberado') out.push('Tu servicio social está liberado. Recoge tu constancia en la oficina.');
  return out.length ? out : ['Estás al día. No tienes entregas pendientes.'];
}

function homeStudent(u){
  const st = studentOfUser(u.id); const exp = st && expOfStudent(st.id);
  const docs = exp ? docsOfExp(exp.id) : [];
  const prog = exp && byId('programs', exp.programId);
  return `
  <div class="hello">
    <div>
      <h1>Hola, ${esc(firstName(u.name))}</h1>
      <p>${prog ? `Prestas tu servicio en <b>${esc(prog.name)}</b> con ${esc(prog.receiver)}.` : 'Aún no tienes programa asignado.'}</p>
    </div>
    ${exp ? stamp(exp.status, true) : ''}
  </div>
  <div class="next"><h3>Lo que sigue</h3><ul>${nextSteps(exp).map(s => `<li>${s}</li>`).join('')}</ul></div>

  <div class="section grid-2-1">
    <div>
      <div class="section-head"><h2>Horas acumuladas</h2><p>Se suman con cada reporte enviado.</p></div>
      ${hoursRuler(exp ? exp.hours : 0)}
    </div>
    <div>
      <div class="section-head"><h2>Tus documentos</h2><a href="#/mi-servicio">Abrir expediente</a></div>
      <p>${plural(docs.length,'documento','documentos')} entregados; ${plural(docs.filter(d=>['validado','aprobado'].includes(d.status)).length,'aceptado','aceptados')}, ${plural(docs.filter(d=>d.status==='recibido').length,'en revisión','en revisión')}.</p>
    </div>
  </div>

  <div class="section">
    <div class="section-head"><h2>Cómo avanza tu servicio social</h2><p>Los formatos y plazos definitivos los confirma la oficina de Servicio Social.</p></div>
    ${stagesOf(exp)}
  </div>`;
}

function homeStaff(u){
  const pend = pendingDocs();
  const obs = db.documents.filter(d => d.status === 'observado').length;
  const preReg = db.expedientes.filter(e => e.status === 'pre_registro').length;
  const toRelease = db.expedientes.filter(e => e.status !== 'liberado' && e.status !== 'baja' && e.hours >= REQUIRED_HOURS).length;
  const active = db.expedientes.filter(e => !['liberado','baja'].includes(e.status)).length;
  const released = db.expedientes.filter(e => e.status === 'liberado').length;
  const ev = db.events.slice().sort((a,b) => b.created.localeCompare(a.created)).slice(0,6);
  const tray = [
    [pend.length, 'Documentos por revisar', `${obs} con observaciones en espera de corrección`, 'revision'],
    [preReg, 'Expedientes en pre-registro', 'Falta asignar programa o fecha de inicio', 'expedientes'],
    [toRelease, 'Listos para liberación', 'Cumplen 500 horas y esperan revisión final', 'expedientes']
  ];
  return `
  <div class="page-head">
    <div><h1>Resumen del servicio social</h1>
    <p>${plural(db.students.length,'estudiante registrado','estudiantes registrados')}, ${plural(active,'expediente activo','expedientes activos')} y ${plural(released,'servicio liberado','servicios liberados')}.</p></div>
    ${u.role==='admin' ? '<a class="btn primary" href="#/estudiantes">Registrar estudiante</a>' : '<a class="btn primary" href="#/revision">Revisar documentos</a>'}
  </div>
  <div class="grid-2-1">
    <div>
      <div class="section-head"><h2>Tu bandeja</h2><p>Lo que necesita a alguien del personal.</p></div>
      <div class="tray">${tray.map(([n,t,s,r]) => `<a href="#/${r}"><span class="num ${n?'':'zero'}">${n}</span><span><b>${t}</b><small>${s}</small></span><span class="go">Atender</span></a>`).join('')}</div>
    </div>
    <div>
      <div class="section-head"><h2>Actividad reciente</h2><a href="#/bitacora">Ver bitácora</a></div>
      ${ev.length ? `<ul class="log">${ev.map(logItem).join('')}</ul>` : '<div class="empty">Sin movimientos todavía.</div>'}
    </div>
  </div>`;
}

/* ---------- Página: mi servicio social (estudiante) ---------- */
function docRow(d, opts={}){
  const ext = (d.name.split('.').pop() || '').toUpperCase().slice(0,4);
  const noteWarn = ['observado','rechazado'].includes(d.status);
  const editable = opts.student && EDITABLE_DOC.includes(d.status);
  return `<div class="doc">
    <span class="doc-ico" aria-hidden="true">${esc(ext)}</span>
    <div class="doc-main">
      <b>${esc(DOC_TYPES[d.type] || d.type)}</b>
      <div class="doc-meta">${esc(d.name)}${d.size?`, ${fmtSize(d.size)}`:''}${d.folio?`. Folio ${esc(d.folio)}`:''}${d.period?`. ${esc(d.period)}`:''}</div>
      ${opts.showStudent ? `<div class="doc-meta">${esc(opts.showStudent)}</div>` : ''}
      <div class="doc-meta">Entregado el ${fmtDateTime(d.created)}${d.reviewed?`; revisado el ${fmtDateTime(d.reviewed)}`:''}</div>
      ${d.notes ? `<div class="doc-note ${noteWarn?'warn':''}">${esc(d.notes)}</div>` : ''}
    </div>
    <div class="doc-side">
      ${stamp(d.status)}
      <div class="doc-actions"><button class="btn small" data-click="download" data-id="${d.id}">Descargar</button></div>
    </div>
    ${editable ? `<details class="edit"><summary>Corregir este documento</summary>
      <form class="form cols" data-action="updateDoc" data-id="${d.id}">
        <label class="field">Tipo<select name="type">${options(DOC_TYPES, d.type)}</select></label>
        <label class="field">Reemplazar archivo <span class="hint">Opcional. PDF, JPG o PNG hasta 5 MB.</span><input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png"></label>
        <label class="field">Folio<input name="folio" value="${esc(d.folio||'')}"></label>
        <label class="field">Periodo<input name="period" value="${esc(d.period||'')}"></label>
        <label class="field">Fecha del documento<input type="date" name="date" value="${esc(d.date||'')}"></label>
        <div class="form-end"><button class="btn primary small">Guardar y reenviar a revisión</button></div>
      </form></details>` : ''}
  </div>`;
}

function pageMyFile(u){
  const st = studentOfUser(u.id); const exp = st && expOfStudent(st.id);
  if(!exp) return `<div class="empty"><b>Aún no tienes expediente.</b>Acude a la oficina de Servicio Social para que lo abran.</div>`;
  const prog = byId('programs', exp.programId);
  const docs = docsOfExp(exp.id); const reps = reportsOfExp(exp.id);
  const freePeriods = [1,2,3].filter(n => !reps.some(r => r.period === n));
  return `
  <div class="page-head">
    <div><h1>Mi expediente</h1><p>Número de control ${esc(st.control)}, ${esc(st.career)}.</p></div>
    ${stamp(exp.status, true)}
  </div>
  <dl class="facts">
    <div class="fact"><dt>Programa receptor</dt><dd>${esc(prog ? prog.name : 'Por asignar')}</dd></div>
    <div class="fact"><dt>Fecha de inicio</dt><dd>${fmtDate(exp.start)}</dd></div>
    <div class="fact"><dt>Término estimado</dt><dd>${fmtDate(exp.end)}</dd></div>
    <div class="fact"><dt>Plan de trabajo, fecha límite</dt><dd>${fmtDate(exp.planDue)}</dd></div>
    <div class="fact"><dt>Inducción</dt><dd>${exp.induction?'Registrada':'Pendiente'}</dd></div>
    <div class="fact"><dt>Créditos</dt><dd>${st.credits}%</dd></div>
  </dl>

  <div class="section">${hoursRuler(exp.hours)}</div>

  <div class="section grid-2-1">
    <div>
      <div class="section-head"><h2>Documentos entregados</h2><p>Si alguno tiene observaciones, corrígelo y se reenvía a revisión.</p></div>
      ${docs.length ? `<div class="docs">${docs.map(d => docRow(d, {student:true})).join('')}</div>`
        : '<div class="empty"><b>Todavía no entregas documentos.</b>Empieza con tu solicitud usando el formulario.</div>'}
    </div>
    <div>
      <div class="box tint">
        <h3 style="margin-bottom:4px">Entregar un documento</h3>
        <p class="notice" style="margin:0 0 16px">PDF, JPG o PNG de hasta 5 MB.</p>
        <form class="form" data-action="uploadDoc">
          <label class="field">Tipo de documento<select name="type" required>${options(DOC_TYPES)}</select></label>
          <label class="field">Archivo<input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" required></label>
          <label class="field">Folio <span class="hint">Si el documento tiene uno, por ejemplo SS-2026-001.</span><input name="folio"></label>
          <label class="field">Periodo o bimestre<input name="period" placeholder="Bimestre 1"></label>
          <label class="field">Fecha del documento<input type="date" name="date"></label>
          <button class="btn primary full">Entregar documento</button>
        </form>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-head"><h2>Reportes bimestrales</h2><p>Cada reporte suma sus horas a tu total.</p></div>
    ${reps.length ? `<div class="table-wrap" style="margin-bottom:24px"><table>
      <thead><tr><th>Periodo</th><th>Actividades</th><th>Horas</th><th>Estado</th><th>Enviado</th></tr></thead>
      <tbody>${reps.map(r => `<tr><td><b>Bimestre ${r.period}</b></td><td>${esc(r.activities)}</td><td>${r.hours}</td><td>${stamp(r.status)}</td><td>${fmtDateTime(r.submitted)}</td></tr>`).join('')}</tbody>
    </table></div>` : ''}
    ${freePeriods.length ? `<form class="form cols" data-action="createReport">
      <label class="field">Bimestre<select name="period">${freePeriods.map(n => `<option value="${n}">Bimestre ${n}</option>`).join('')}</select></label>
      <label class="field">Horas del periodo<input type="number" name="hours" min="1" max="500" step="0.5" required></label>
      <label class="field">Fecha límite<input type="date" name="due"></label>
      <label class="field span">Actividades realizadas<textarea name="activities" rows="3" required placeholder="Describe brevemente lo que hiciste en el periodo."></textarea></label>
      <div class="form-end"><button class="btn primary">Enviar reporte</button></div>
    </form>` : '<div class="empty"><b>Ya enviaste los tres reportes bimestrales.</b>Sigue con tu reporte final y carta de terminación.</div>'}
  </div>`;
}

/* ---------- Página: estudiantes (admin) ---------- */
function pageStudents(){
  const rows = db.students.slice().sort((a,b) => (b.created||'').localeCompare(a.created||''));
  return `
  <div class="page-head"><div><h1>Estudiantes</h1><p>Prestadores registrados y sus datos académicos. Al registrar a alguien se abre su expediente.</p></div></div>
  <div class="table-wrap"><table>
    <thead><tr><th>Estudiante</th><th>Número de control</th><th>Carrera</th><th>Semestre</th><th>Créditos</th><th>Expediente</th></tr></thead>
    <tbody>${rows.map(s => { const u = userById(s.userId); const e = expOfStudent(s.id); return `<tr>
      <td><b>${esc(u?u.name:'Sin usuario')}</b><small>${esc(u?u.email:'')}</small></td>
      <td>${esc(s.control)}</td><td>${esc(s.career)}</td><td>${s.semester}</td>
      <td><span class="pct ${s.credits<70?'low':''}">${s.credits}%</span></td>
      <td>${e?stamp(e.status):'—'}</td></tr>`; }).join('')}</tbody>
  </table></div>

  <div class="section">
    <div class="section-head"><h2>Registrar estudiante</h2><p>La contraseña temporal se la compartes al estudiante.</p></div>
    <form class="form cols" data-action="createStudent">
      <label class="field">Nombre completo<input name="name" required></label>
      <label class="field">Correo electrónico<input type="email" name="email" required></label>
      <label class="field">Contraseña temporal<input name="password" value="cambiar123" required minlength="6"></label>
      <label class="field">Número de control<input name="control" required pattern="[0-9A-Za-z]{6,12}" title="Entre 6 y 12 letras o números"></label>
      <label class="field">Carrera<input name="career" value="Ingeniería en Sistemas Computacionales" required></label>
      <label class="field">Semestre<input type="number" name="semester" min="1" max="15" value="7" required></label>
      <label class="field">Porcentaje de créditos <span class="hint">Se requiere al menos 70%.</span><input type="number" name="credits" min="0" max="100" step="0.01" value="70" required></label>
      <label class="field">Programa<select name="program"><option value="">Por asignar</option>${db.programs.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
      <div class="form-end"><button class="btn primary">Registrar y abrir expediente</button></div>
    </form>
  </div>`;
}

/* ---------- Página: expedientes ---------- */
function pageFiles(u){
  const rows = db.expedientes.slice().sort((a,b) => (b.updated||'').localeCompare(a.updated||''));
  const allowed = u.role === 'admin' ? EXP_STATUS : Object.fromEntries(Object.entries(EXP_STATUS).filter(([k]) => k !== 'liberado'));
  return `
  <div class="page-head"><div><h1>Expedientes</h1><p>Avance de cada prestador. ${u.role==='supervisor'?'La liberación final la autoriza Administración.':'Solo Administración puede marcar un expediente como liberado.'}</p></div></div>
  <div class="table-wrap"><table>
    <thead><tr><th>Estudiante</th><th>Programa</th><th>Horas</th><th>Estado</th><th>Actualizar estado</th></tr></thead>
    <tbody>${rows.map(e => { const s = byId('students', e.studentId); const p = byId('programs', e.programId); const locked = u.role==='supervisor' && e.status==='liberado'; return `<tr>
      <td><b>${esc(studentNameOfExp(e))}</b><small>${esc(s?s.control:'')}</small></td>
      <td>${esc(p?p.name:'Sin asignar')}${e.notes?`<small>${esc(e.notes)}</small>`:''}</td>
      <td style="white-space:nowrap"><b>${e.hours} / ${REQUIRED_HOURS}</b></td>
      <td>${stamp(e.status)}</td>
      <td>${locked ? '<small>Liberado por Administración</small>' : `<form class="inline" data-action="updateExp" data-id="${e.id}">
        <label class="sr-only" for="st${e.id}">Estado</label><select id="st${e.id}" name="status">${options(allowed, e.status)}</select>
        <label class="sr-only" for="nt${e.id}">Observación</label><input id="nt${e.id}" name="notes" placeholder="Observación breve" value="${esc(e.notes||'')}">
        <button class="btn small">Guardar</button></form>`}</td></tr>`; }).join('')}</tbody>
  </table></div>`;
}

/* ---------- Página: revisión de documentos ---------- */
function pageReview(u){
  const order = {observado:0, recibido:1, rechazado:2, validado:3, aprobado:4};
  let rows = db.documents.slice().sort((a,b) => (order[a.status]-order[b.status]) || b.created.localeCompare(a.created));
  const f = ui.reviewFilter;
  if(f === 'pendientes') rows = rows.filter(d => d.status === 'recibido' || d.status === 'observado');
  else if(f === 'resueltos') rows = rows.filter(d => !['recibido','observado'].includes(d.status));
  const statusOpts = u.role === 'admin' ? {validado:'Validado', observado:'Observado', rechazado:'Rechazado', aprobado:'Aprobado oficialmente'} : {validado:'Validado', observado:'Observado', rechazado:'Rechazado'};
  const chip = (k, l) => `<button class="chip" data-click="filter" data-f="${k}" aria-pressed="${f===k}">${l}</button>`;
  return `
  <div class="page-head"><div><h1>Revisión de documentos</h1><p>Descarga el archivo, coteja los datos y registra el resultado con una observación. El sistema avisa si un folio ya se usó, pero la validación es tuya.</p></div></div>
  <div class="filters" role="group" aria-label="Filtrar documentos">${chip('pendientes','Por revisar')}${chip('resueltos','Ya revisados')}${chip('todos','Todos')}</div>
  ${rows.length ? `<div class="docs">${rows.map(d => {
    const exp = byId('expedientes', d.expId); const s = exp && byId('students', exp.studentId);
    const who = exp ? `${studentNameOfExp(exp)}, control ${s?s.control:''}` : '';
    return docRow(d, {showStudent:who}).replace(/<\/div>\s*$/, `
      <details class="edit"${['recibido','observado'].includes(d.status)?' open':''}><summary>Registrar revisión</summary>
        <form class="form cols" data-action="reviewDoc" data-id="${d.id}">
          <label class="field">Resultado<select name="status">${options(statusOpts, 'validado')}</select></label>
          <label class="field span">Motivo u observación<input name="notes" required placeholder="Por ejemplo: falta la firma del responsable"></label>
          <div class="form-end"><button class="btn primary small">Registrar revisión</button></div>
        </form></details></div>`);
  }).join('')}</div>` : `<div class="empty"><b>${f==='pendientes'?'No hay documentos por revisar.':'No hay documentos en esta vista.'}</b>${f==='pendientes'?'Cuando un estudiante entregue algo aparecerá aquí.':''}</div>`}`;
}

/* ---------- Página: bitácora ---------- */
function logItem(e){
  const u = e.userId ? userById(e.userId) : null;
  return `<li><b>${esc(e.desc)}</b><small>${esc(u?u.name:'Sistema')}, ${fmtDateTime(e.created)}</small></li>`;
}
function pageLog(u){
  let rows = db.events.slice().sort((a,b) => b.created.localeCompare(a.created));
  if(u.role === 'student'){
    const st = studentOfUser(u.id); const ids = db.expedientes.filter(e => st && e.studentId === st.id).map(e => e.id);
    rows = rows.filter(e => ids.includes(e.expId) || e.userId === u.id);
  }
  rows = rows.slice(0, 100);
  let html = '', day = '';
  rows.forEach(e => {
    const d = new Date(e.created).toLocaleDateString('es-MX', {weekday:'long', day:'numeric', month:'long'});
    if(d !== day){ if(day) html += '</ul>'; html += `<div class="log-day">${esc(d.charAt(0).toUpperCase()+d.slice(1))}</div><ul class="log">`; day = d; }
    html += logItem(e);
  });
  if(day) html += '</ul>';
  return `<div class="page-head"><div><h1>Bitácora</h1><p>${u.role==='student'?'Movimientos de tu expediente.':'Todo lo que ha pasado en el portal, del más reciente al más antiguo.'}</p></div></div>
    ${html || '<div class="empty">Sin movimientos todavía.</div>'}`;
}

/* ---------- Validación de archivos ---------- */
function checkFile(file){
  if(!file) return 'Selecciona un archivo.';
  const ext = file.name.split('.').pop().toLowerCase();
  if(!ALLOWED_EXT.includes(ext)) return 'Ese formato no se acepta. Usa PDF, JPG o PNG.';
  if(file.size > MAX_FILE) return `El archivo pesa ${fmtSize(file.size)}. El máximo es 5 MB.`;
  return null;
}
const folioTaken = (folio, exceptId) => !!folio && db.documents.some(d => d.folio && d.folio.toLowerCase() === folio.toLowerCase() && d.id !== exceptId);

/* ---------- Acciones de formularios ---------- */
const actions = {
  async login(fd){
    const email = String(fd.get('email')||'').trim().toLowerCase();
    const u = db.users.find(x => x.email.toLowerCase() === email && x.active);
    if(!u || u.pass !== await hashPw(String(fd.get('password')||''))){ toast('El correo o la contraseña no coinciden. Revisa e intenta de nuevo.', 'error'); return; }
    sessionStorage.setItem(SESSION_KEY, u.id);
    toast(`Sesión iniciada como ${u.name}.`);
    go('inicio');
  },

  async createStudent(fd){
    if(!can('admin')) return;
    const email = String(fd.get('email')).trim().toLowerCase();
    const control = String(fd.get('control')).trim();
    if(db.users.some(u => u.email.toLowerCase() === email)){ toast('Ya existe una cuenta con ese correo.', 'error'); return; }
    if(db.students.some(s => s.control === control)){ toast('Ese número de control ya está registrado.', 'error'); return; }
    const uid = nextId('users');
    db.users.push({id:uid, name:String(fd.get('name')).trim(), email, pass:await hashPw(String(fd.get('password'))), role:'student', active:true});
    const sid = nextId('students');
    db.students.push({id:sid, userId:uid, control, career:String(fd.get('career')).trim(), semester:parseInt(fd.get('semester'),10), credits:parseFloat(fd.get('credits')), created:nowISO()});
    const eid = nextId('expedientes');
    db.expedientes.push({id:eid, studentId:sid, programId:fd.get('program')?Number(fd.get('program')):null, status:'pre_registro', start:null, end:null, induction:false, planDue:null, hours:0, notes:'', updated:nowISO()});
    logEvent('alta_estudiante', `Se registró a ${fd.get('name')} (${control})`, eid);
    save(); toast(`Registrado. Puede entrar con ${email}.`); render();
  },

  async uploadDoc(fd, form){
    if(!can('student')) return;
    const st = studentOfUser(me().id); const exp = st && expOfStudent(st.id);
    const file = form.querySelector('input[type=file]').files[0];
    const err = !exp ? 'No tienes expediente abierto.' : checkFile(file);
    if(err){ toast(err, 'error'); return; }
    const id = nextId('documents'); const key = 'doc-' + id + '-' + Date.now();
    try{ await Files.put(key, file); }catch(e){ toast('El navegador no permitió guardar el archivo. Libera espacio o usa otro navegador.', 'error'); return; }
    const folio = String(fd.get('folio')||'').trim();
    const dup = folioTaken(folio);
    db.documents.push({id, expId:exp.id, type:fd.get('type'), name:file.name, fileKey:key, size:file.size, mime:file.type, folio:folio||null,
      period:String(fd.get('period')||'').trim(), date:fd.get('date')||null, status:dup?'observado':'recibido',
      notes:dup?'Este folio ya aparece en otro documento. El personal lo revisará.':'Pendiente de validación administrativa.',
      uploadedBy:me().id, reviewedBy:null, created:nowISO(), reviewed:null});
    exp.updated = nowISO();
    logEvent('carga_documento', `Documento entregado: ${DOC_TYPES[fd.get('type')]} (${file.name})`, exp.id);
    save(); toast(dup ? 'Documento entregado. Ojo: el folio ya existe en otro documento.' : 'Documento entregado. Te avisaremos cuando lo revisen.', dup?'warn':'success'); render();
  },

  async updateDoc(fd, form){
    if(!can('student')) return;
    const d = byId('documents', form.dataset.id);
    const st = studentOfUser(me().id); const exp = st && expOfStudent(st.id);
    if(!d || !exp || d.expId !== exp.id || !EDITABLE_DOC.includes(d.status)){ toast('Este documento ya fue aceptado y no se puede corregir.', 'error'); return; }
    const file = form.querySelector('input[type=file]').files[0];
    if(file){
      const err = checkFile(file); if(err){ toast(err, 'error'); return; }
      const key = 'doc-' + d.id + '-' + Date.now();
      try{ await Files.put(key, file); }catch(e){ toast('El navegador no permitió guardar el archivo.', 'error'); return; }
      if(d.fileKey) Files.del(d.fileKey).catch(()=>{});
      Object.assign(d, {fileKey:key, name:file.name, size:file.size, mime:file.type});
    }
    const type = fd.get('type'); if(DOC_TYPES[type]) d.type = type;
    const folio = String(fd.get('folio')||'').trim(); const dup = folioTaken(folio, d.id);
    Object.assign(d, {folio:folio||null, period:String(fd.get('period')||'').trim(), date:fd.get('date')||null,
      status:dup?'observado':'recibido', notes:dup?'Este folio ya aparece en otro documento. El personal lo revisará.':'Corregido por el estudiante; pendiente de nueva revisión.',
      reviewedBy:null, reviewed:null, created:nowISO()});
    logEvent('edicion_documento', `Documento corregido y reenviado: ${DOC_TYPES[d.type]}`, d.expId);
    save(); toast('Cambios guardados. El documento volvió a revisión.'); render();
  },

  async reviewDoc(fd, form){
    if(!can('admin','supervisor')) return;
    const d = byId('documents', form.dataset.id); if(!d) return;
    let status = fd.get('status');
    const allowed = me().role === 'admin' ? ['validado','observado','rechazado','aprobado'] : ['validado','observado','rechazado'];
    if(!allowed.includes(status)) status = 'observado';
    Object.assign(d, {status, notes:String(fd.get('notes')||'').trim(), reviewedBy:me().id, reviewed:nowISO()});
    const exp = byId('expedientes', d.expId); if(exp) exp.updated = nowISO();
    logEvent('revision_documento', `${DOC_TYPES[d.type]} de ${exp?studentNameOfExp(exp):'estudiante'}: ${DOC_STATUS[status].toLowerCase()}. ${d.notes}`, d.expId);
    save(); toast(`Revisión registrada: ${DOC_STATUS[status]}.`); render();
  },

  async createReport(fd){
    if(!can('student')) return;
    const st = studentOfUser(me().id); const exp = st && expOfStudent(st.id);
    if(!exp){ toast('No tienes expediente abierto.', 'error'); return; }
    const period = parseInt(fd.get('period'),10); const hours = parseFloat(fd.get('hours'));
    if(db.reports.some(r => r.expId === exp.id && r.period === period)){ toast(`Ya enviaste el reporte del bimestre ${period}.`, 'error'); return; }
    if(!(hours > 0)){ toast('Escribe las horas del periodo.', 'error'); return; }
    db.reports.push({id:nextId('reports'), expId:exp.id, period, activities:String(fd.get('activities')).trim(), hours, status:'enviado', due:fd.get('due')||null, submitted:nowISO()});
    exp.hours = Math.round((exp.hours + hours) * 100) / 100; exp.updated = nowISO();
    if(exp.status === 'pre_registro') exp.status = 'en_proceso';
    logEvent('reporte_enviado', `Reporte bimestral ${period} enviado (${hours} h)`, exp.id);
    save(); toast(`Reporte enviado. Llevas ${exp.hours} horas.`); render();
  },

  async updateExp(fd, form){
    if(!can('admin','supervisor')) return;
    const e = byId('expedientes', form.dataset.id); if(!e) return;
    let status = fd.get('status');
    if(!EXP_STATUS[status]) status = 'pendiente_revision';
    if(me().role === 'supervisor' && status === 'liberado'){ toast('La liberación final la autoriza Administración.', 'error'); return; }
    e.status = status; e.notes = String(fd.get('notes')||'').trim(); e.updated = nowISO();
    if(status === 'en_proceso' && !e.start){ e.start = today(); e.end = addMonths(today(), 6); e.planDue = addDays(today(), 20); }
    logEvent('estado_expediente', `Expediente de ${studentNameOfExp(e)} marcado como ${EXP_STATUS[status].toLowerCase()}`, e.id);
    save(); toast('Expediente actualizado.'); render();
  }
};

/* ---------- Acciones de clic ---------- */
const clicks = {
  logout(){ sessionStorage.removeItem(SESSION_KEY); location.hash = '#/login'; render(); },
  fill(btn){ $('#email').value = btn.dataset.email; $('#password').value = 'password'; $('#password').focus(); },
  filter(btn){ ui.reviewFilter = btn.dataset.f; render(); },
  async download(btn){
    const d = byId('documents', btn.dataset.id); const u = me(); if(!d || !u) return;
    const exp = byId('expedientes', d.expId); const st = exp && byId('students', exp.studentId);
    const allowed = u.role !== 'student' || (st && st.userId === u.id);
    if(!allowed){ toast('Solo puedes descargar documentos de tu propio expediente.', 'error'); return; }
    let blob = d.fileKey ? await Files.get(d.fileKey).catch(() => null) : null;
    let name = d.name;
    if(!blob){
      blob = new Blob([`Documento de ejemplo: ${d.name}\nTipo: ${DOC_TYPES[d.type]}\nFolio: ${d.folio||'—'}\n\nEste registro viene con los datos de demostración y no tiene archivo real.\nEntrega un documento desde "Mi servicio social" para probar la descarga.`], {type:'text/plain'});
      name = d.name.replace(/\.[^.]+$/, '') + '_ejemplo.txt';
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
  async reset(){
    if(!confirm('Se borrarán los cambios y archivos que hiciste en este navegador y volverán los datos de ejemplo. ¿Continuar?')) return;
    await Files.clear().catch(()=>{});
    localStorage.removeItem(DB_KEY); sessionStorage.removeItem(SESSION_KEY);
    await seed(); location.hash = '#/login'; render(); toast('Datos de demostración restablecidos.');
  }
};

document.addEventListener('submit', async ev => {
  const form = ev.target.closest('form[data-action]'); if(!form) return;
  ev.preventDefault();
  if(!form.checkValidity()){ form.reportValidity(); return; }
  const btn = form.querySelector('button:not([type=button])'); if(btn) btn.disabled = true;
  try{ await actions[form.dataset.action](new FormData(form), form); }
  catch(e){ console.error(e); toast('Algo falló al guardar. Recarga la página e intenta de nuevo.', 'error'); }
  finally{ if(btn && document.body.contains(btn)) btn.disabled = false; }
});
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-click]'); if(!el) return;
  ev.preventDefault(); clicks[el.dataset.click](el);
});
window.addEventListener('hashchange', () => { render(); window.scrollTo(0,0); });
window.addEventListener('storage', e => { if(e.key === DB_KEY){ loadDb().then(render); } });

loadDb().then(render);
})();
