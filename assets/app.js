/* NexoTec · Servicio Social en Línea
   Versión estática para GitHub Pages: no necesita PHP ni MySQL.
   Los datos se guardan en el navegador (localStorage) y los archivos en IndexedDB.

   Automatización: un motor de reglas valida documentos y reportes, avanza las etapas,
   calcula fechas, genera recordatorios y libera el servicio con su constancia.
   El personal solo interviene en las excepciones que el motor no puede resolver. */
(function(){
'use strict';

const DB_KEY = 'nexotec_ss_db_v2';
const SESSION_KEY = 'nexotec_ss_session';
const REQUIRED_HOURS = 500;
const MIN_CREDITS = 70;
const MIN_MONTHS = 6;
const PLAN_DAYS = 20;
const REPORT_GRACE_DAYS = 5;
const MAX_REPORT_HOURS = 250;
const MAX_FILE = 5 * 1024 * 1024;
const MAX_ATTEMPTS = 2;
const ALLOWED_EXT = ['pdf','jpg','jpeg','png'];
const SITE_YEAR = new Date().getFullYear();

/* ---------- Catálogos ---------- */
const DOC_TYPES = {
  solicitud:'Solicitud', carta_compromiso:'Carta compromiso', carta_aceptacion:'Carta de aceptación',
  plan_trabajo:'Plan de trabajo', reporte_bimestral:'Reporte bimestral', evaluacion:'Evaluación',
  reporte_final:'Reporte final', carta_terminacion:'Carta de terminación', otro:'Otro'
};
/* Qué documentos se pueden entregar en cada etapa (los reportes bimestrales van en su propio formulario) */
const STAGE_DOCS = {
  inicio:['solicitud','carta_compromiso','carta_aceptacion','plan_trabajo','otro'],
  desarrollo:['plan_trabajo','evaluacion','otro'],
  cierre:['reporte_final','carta_terminacion','evaluacion','otro'],
  liberado:['otro']
};
const MULTI_DOCS = ['evaluacion','otro','reporte_bimestral'];
const EXP_STATUS = {
  pre_registro:'Pre-registro', en_proceso:'En proceso', pendiente_revision:'Pendiente de revisión',
  observado:'Observado', completo:'Completo', liberado:'Liberado', baja:'Baja'
};
const DOC_STATUS = { recibido:'En revisión', validado:'Validado', observado:'Observado', rechazado:'Rechazado', aprobado:'Aprobado' };
const REPORT_STATUS = { enviado:'En revisión', evaluado:'Evaluado', observado:'Observado' };
const TONE = {
  pre_registro:'neutral', en_proceso:'ink', pendiente_revision:'warn', observado:'warn', completo:'ok',
  liberado:'ok', baja:'bad', recibido:'neutral', validado:'ok', aprobado:'ok', rechazado:'bad',
  enviado:'neutral', evaluado:'ok'
};
const ROLE_LABEL = { admin:'Administración', student:'Estudiante', supervisor:'Supervisión' };
const EDITABLE_DOC = ['recibido','observado','rechazado'];
const STAGE_LABEL = { inicio:'Inicio', desarrollo:'Desarrollo', cierre:'Cierre', liberado:'Liberado' };

/* ---------- Utilidades ---------- */
const $ = (s, el=document) => el.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => new Date().toISOString().slice(0,10);
const addDays = (d, n) => { const x = new Date(String(d).slice(0,10) + 'T12:00:00'); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10); };
const addMonths = (d, n) => { const x = new Date(String(d).slice(0,10) + 'T12:00:00'); x.setMonth(x.getMonth()+n); return x.toISOString().slice(0,10); };
const daysUntil = d => Math.round((new Date(d + 'T12:00:00') - new Date(today() + 'T12:00:00')) / 86400000);
const nowISO = () => new Date().toISOString();
function fmtDate(v){
  if(!v) return 'Pendiente';
  const d = v.length === 10 ? new Date(v + 'T12:00:00') : new Date(v);
  return isNaN(d) ? v : d.toLocaleDateString('es-MX', {day:'numeric', month:'short', year:'numeric'});
}
function fmtDateTime(v){
  if(!v) return '—';
  return new Date(v).toLocaleString('es-MX', {day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'});
}
function fmtSize(b){ if(!b) return ''; return b < 1024*1024 ? Math.max(1, Math.round(b/1024))+' KB' : (b/1024/1024).toFixed(1)+' MB'; }
const rot = n => ((n * 37) % 7 - 3) * 0.7;
function stamp(status, big){
  const label = EXP_STATUS[status] || DOC_STATUS[status] || REPORT_STATUS[status] || status;
  return `<span class="stamp ${TONE[status]||'neutral'}${big?' big':''}" style="--rot:${rot(label.length)}deg">${esc(label)}</span>`;
}
function options(map, selected, keys){
  return (keys || Object.keys(map)).map(k => `<option value="${k}"${k===selected?' selected':''}>${esc(map[k])}</option>`).join('');
}
const firstName = n => String(n||'').split(' ')[0];
const plural = (n, one, many) => `${n} ${n===1?one:many}`;

async function sha256(buf){
  if(window.crypto && crypto.subtle){
    const h = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2,'0')).join('');
  }
  let h = 0; const v = new Uint8Array(buf); for(let i = 0; i < v.length; i++) h = (h * 31 + v[i]) | 0; return 'x' + h + '-' + v.length;
}
async function hashPw(pw){
  if(window.crypto && crypto.subtle) return 'sha256:' + await sha256(new TextEncoder().encode('nexotec:' + pw));
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
      const t = db.transaction('files', mode); const req = fn(t.objectStore('files'));
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
  const OKCHECKS = [{ok:true,label:'Formato y tamaño permitidos'},{ok:true,label:'El contenido coincide con el tipo de archivo'},{ok:true,label:'Sin duplicados en otros expedientes'},{ok:true,label:'Corresponde a la etapa actual'}];
  db = { version:2, seq:{}, users:[], students:[], programs:[], expedientes:[], documents:[], reports:[], events:[], notifications:[] };

  db.programs = [
    {id:1, name:'Programa de apoyo comunitario', receiver:'Ayuntamiento de Matehuala', cupo:10, careers:[]},
    {id:2, name:'AlfabetizaTec', receiver:'Programa institucional', cupo:20, careers:[]},
    {id:3, name:'Apoyo en laboratorio de cómputo', receiver:'Departamento de Sistemas y Computación', cupo:3, careers:['Ingeniería en Sistemas Computacionales']}
  ];
  const addUser = (name, email, role) => { const id = nextId('users'); db.users.push({id, name, email, pass, role, active:true}); return id; };
  const addStudent = (uid, control, career, semester, credits, createdDaysAgo) => { const id = nextId('students'); db.students.push({id, userId:uid, control, career, semester, credits, created:ago(createdDaysAgo)}); return id; };
  const addExp = o => { const id = nextId('expedientes'); db.expedientes.push(Object.assign({id, programId:null, status:'pre_registro', start:null, end:null, induction:false, inductionDate:null, planDue:null, hours:0, notes:'', releaseFolio:null, releasedAt:null, updated:nowISO()}, o)); return id; };
  let folioN = 0;
  const addDoc = (expId, uid, type, name, status, daysAgo, extra={}) => {
    const id = nextId('documents'); folioN++;
    db.documents.push(Object.assign({id, expId, type, name, fileKey:null, size:120000 + id*9137, hash:'seed-'+id, folio:`SS-${SITE_YEAR}-${String(folioN).padStart(3,'0')}`,
      period:'', date:addDays(t,-daysAgo), status, notes:status==='validado'?'Validado automáticamente.':'', checks:OKCHECKS, auto:true, exception:false, attempts:1,
      uploadedBy:uid, reviewedBy:null, created:ago(daysAgo), reviewed:status==='recibido'?null:ago(daysAgo, 10)}, extra));
    return id;
  };
  const addReport = (expId, uid, period, hours, daysAgo, startDate) => {
    const docId = addDoc(expId, uid, 'reporte_bimestral', `reporte_bimestre_${period}.pdf`, 'validado', daysAgo, {period:`Bimestre ${period}`});
    db.reports.push({id:nextId('reports'), expId, period, activities:'Captura de información, apoyo en jornadas de registro y elaboración de reportes semanales para el programa.', hours,
      status:'evaluado', due:addDays(addMonths(startDate, 2*period), REPORT_GRACE_DAYS), submitted:ago(daysAgo), docId, note:'Evaluado automáticamente: horas dentro del rango y actividades descritas.', auto:true, exception:false, attempts:1});
  };

  // Administración y supervisión
  addUser('Administración NexoTec', 'admin@demo.local', 'admin');
  const uSup = addUser('Mtro. Ernesto Salazar', 'supervisor@demo.local', 'supervisor');

  // Ana: en desarrollo, 120 h, con un documento observado por el motor
  const uAna = addUser('Ana Lucía Rodríguez', 'alumno@demo.local', 'student');
  const sAna = addStudent(uAna, '22010001', 'Ingeniería en Sistemas Computacionales', 8, 78, 90);
  const anaStart = addDays(t, -75);
  const eAna = addExp({studentId:sAna, programId:1, status:'en_proceso', start:anaStart, end:addMonths(anaStart, MIN_MONTHS), induction:true, inductionDate:addDays(t,-80), planDue:addDays(anaStart, PLAN_DAYS), hours:120});
  addDoc(eAna, uAna, 'solicitud', 'solicitud_servicio_social.pdf', 'validado', 85, {hash:'dup-ana-solicitud'});
  addDoc(eAna, uAna, 'carta_compromiso', 'carta_compromiso.pdf', 'validado', 84, {hash:'shared-compromiso'});
  addDoc(eAna, uAna, 'carta_aceptacion', 'carta_aceptacion_ayuntamiento.pdf', 'validado', 78);
  addDoc(eAna, uAna, 'plan_trabajo', 'plan_de_trabajo.pdf', 'validado', 66);
  addReport(eAna, uAna, 1, 120, 12, anaStart);
  addDoc(eAna, uAna, 'evaluacion', 'evaluacion_bimestre_1.pdf', 'observado', 4, {notes:'El archivo dice ser PDF pero su contenido no es un PDF válido. Vuelve a exportarlo desde Word o el escáner.',
    checks:[{ok:true,label:'Formato y tamaño permitidos'},{ok:false,label:'El contenido coincide con el tipo de archivo'},{ok:true,label:'Sin duplicados en otros expedientes'},{ok:true,label:'Corresponde a la etapa actual'}]});

  // Diego: pre-registro, con dos excepciones para el personal
  const uDiego = addUser('Diego Hernández Ruiz', 'diego@demo.local', 'student');
  const sDiego = addStudent(uDiego, '22010045', 'Ingeniería Industrial', 7, 72, 20);
  const eDiego = addExp({studentId:sDiego, programId:2});
  addDoc(eDiego, uDiego, 'solicitud', 'solicitud_diego.pdf', 'validado', 6);
  addDoc(eDiego, uDiego, 'carta_compromiso', 'carta_compromiso_diego.pdf', 'observado', 1, {hash:'shared-compromiso', exception:true,
    notes:'El archivo es idéntico al que entregó otro estudiante (Ana Lucía Rodríguez). Requiere revisión del personal.',
    checks:[{ok:true,label:'Formato y tamaño permitidos'},{ok:true,label:'El contenido coincide con el tipo de archivo'},{ok:false,label:'Sin duplicados en otros expedientes'},{ok:true,label:'Corresponde a la etapa actual'}], reviewed:null});
  addDoc(eDiego, uDiego, 'otro', 'justificante_medico.pdf', 'recibido', 1, {exception:true, notes:'Documento de tipo "Otro": el sistema no puede validarlo solo.', reviewed:null});

  // Jorge: a un documento de liberarse (prueba la liberación automática)
  const uJorge = addUser('Jorge Castillo Méndez', 'jorge@demo.local', 'student');
  const sJorge = addStudent(uJorge, '21010087', 'Ingeniería Industrial', 9, 88, 260);
  const jStart = addMonths(t, -7);
  const eJorge = addExp({studentId:sJorge, programId:2, status:'en_proceso', start:jStart, end:addMonths(jStart, MIN_MONTHS), induction:true, inductionDate:addDays(jStart,-5), planDue:addDays(jStart, PLAN_DAYS), hours:500});
  ['solicitud','carta_compromiso','carta_aceptacion'].forEach((ty,i) => addDoc(eJorge, uJorge, ty, ty + '_jorge.pdf', 'validado', 220 - i));
  addDoc(eJorge, uJorge, 'plan_trabajo', 'plan_trabajo_jorge.pdf', 'validado', 200);
  addReport(eJorge, uJorge, 1, 170, 150, jStart); addReport(eJorge, uJorge, 2, 165, 90, jStart); addReport(eJorge, uJorge, 3, 165, 30, jStart);
  addDoc(eJorge, uJorge, 'reporte_final', 'reporte_final_jorge.pdf', 'validado', 5);

  // Mariana: liberada con constancia
  const uMar = addUser('Mariana Torres Vega', 'mariana@demo.local', 'student');
  const sMar = addStudent(uMar, '21010112', 'Ingeniería en Gestión Empresarial', 9, 91, 300);
  const mStart = addMonths(t, -9);
  const eMar = addExp({studentId:sMar, programId:3, status:'liberado', start:mStart, end:addMonths(mStart, MIN_MONTHS), induction:true, inductionDate:mStart, planDue:addDays(mStart, PLAN_DAYS), hours:500, releaseFolio:`CL-${SITE_YEAR}-001`, releasedAt:ago(20)});
  ['solicitud','carta_compromiso','carta_aceptacion','plan_trabajo'].forEach((ty,i) => addDoc(eMar, uMar, ty, ty + '_mariana.pdf', 'validado', 270 - i*5));
  addReport(eMar, uMar, 1, 170, 200, mStart); addReport(eMar, uMar, 2, 170, 140, mStart); addReport(eMar, uMar, 3, 160, 80, mStart);
  addDoc(eMar, uMar, 'reporte_final', 'reporte_final_mariana.pdf', 'validado', 25); addDoc(eMar, uMar, 'carta_terminacion', 'carta_terminacion_mariana.pdf', 'validado', 22);

  // Sofía: bloqueada por créditos (sin cuenta de acceso para la demo)
  const uSof = addUser('Sofía Méndez Ibarra', 'sofia@demo.local', 'student');
  const sSof = addStudent(uSof, '23010150', 'Ingeniería en Sistemas Computacionales', 6, 64, 3);
  addExp({studentId:sSof, programId:null});

  const ev = (expId, userId, type, desc, days, auto) => db.events.push({id:nextId('events'), expId, userId, type, desc, created:ago(days, 9), auto});
  ev(eMar, null, 'estado_expediente', `Mariana Torres Vega liberada automáticamente. Constancia CL-${SITE_YEAR}-001`, 20, true);
  ev(eAna, null, 'revision_documento', 'Plan de trabajo de Ana Lucía Rodríguez validado automáticamente', 66, true);
  ev(eAna, null, 'evaluacion_reporte', 'Reporte bimestral 1 de Ana Lucía Rodríguez evaluado automáticamente (120 h)', 12, true);
  ev(eJorge, null, 'revision_documento', 'Reporte final de Jorge Castillo Méndez validado automáticamente', 5, true);
  ev(eDiego, null, 'revision_documento', 'Solicitud de Diego Hernández Ruiz validada automáticamente', 6, true);
  ev(eAna, null, 'revision_documento', 'Evaluación de Ana Lucía Rodríguez observada automáticamente: el contenido no es un PDF válido', 4, true);
  ev(eDiego, null, 'excepcion', 'Carta compromiso de Diego Hernández Ruiz enviada a revisión del personal: archivo idéntico al de otro estudiante', 1, true);
  ev(eDiego, null, 'excepcion', 'Documento "Otro" de Diego Hernández Ruiz enviado a revisión del personal', 1, true);
  ev(eMar, uSup, 'revision_documento', 'Revisión manual de un justificante de Mariana Torres Vega', 60, false);

  runEngine(true);
  save();
}

async function loadDb(){
  try{ db = JSON.parse(localStorage.getItem(DB_KEY)); }catch(e){ db = null; }
  if(!db || db.version !== 2) await seed();
}

/* ---------- Consultas ---------- */
const byId = (table, id) => db[table].find(r => r.id === Number(id));
const userById = id => byId('users', id);
const studentOfUser = uid => db.students.find(s => s.userId === uid);
const expOfStudent = sid => db.expedientes.filter(e => e.studentId === sid).sort((a,b) => b.id - a.id)[0];
const docsOfExp = eid => db.documents.filter(d => d.expId === eid).sort((a,b) => b.created.localeCompare(a.created));
const reportsOfExp = eid => db.reports.filter(r => r.expId === eid).sort((a,b) => a.period - b.period);
const studentOfExp = exp => byId('students', exp.studentId);
const userOfExp = exp => { const s = studentOfExp(exp); return s && userById(s.userId); };
const studentNameOfExp = exp => { const u = userOfExp(exp); return u ? u.name : 'Sin usuario'; };
const staffIds = () => db.users.filter(u => u.role !== 'student').map(u => u.id);
const exceptions = () => ({
  docs: db.documents.filter(d => d.exception),
  reports: db.reports.filter(r => r.exception),
  blocked: db.expedientes.filter(e => e.status !== 'baja' && e.status !== 'liberado' && (byId('students', e.studentId)?.credits ?? 100) < MIN_CREDITS)
});
const exceptionCount = () => { const x = exceptions(); return x.docs.length + x.reports.length + x.blocked.length; };

function logEvent(type, desc, expId=null, auto=false){
  db.events.push({id:nextId('events'), expId, userId:auto ? null : (me()?.id ?? null), type, desc, created:nowISO(), auto});
}
function notify(userIds, key, msg, link){
  [].concat(userIds).forEach(uid => {
    if(!uid) return;
    const k = key + '@' + uid;
    if(db.notifications.some(n => n.key === k)) return;
    db.notifications.push({id:nextId('notifications'), userId:uid, key:k, msg, link:link||'', created:nowISO(), read:false});
  });
}

/* ================================================================
   MOTOR DE REGLAS
   ================================================================ */

/* Lista de requisitos del expediente, agrupada por etapa */
function requirements(exp){
  const st = studentOfExp(exp);
  const docs = docsOfExp(exp.id); const reps = reportsOfExp(exp.id);
  const okDoc = t => docs.some(d => d.type === t && ['validado','aprobado'].includes(d.status));
  const repOk = n => reps.some(r => r.period === n && r.status === 'evaluado');
  const prog = byId('programs', exp.programId);
  const minDate = exp.start ? addMonths(exp.start, MIN_MONTHS) : null;
  const groups = {
    inicio:[
      {k:'creditos', label:`Créditos de al menos ${MIN_CREDITS}%`, done:!!st && st.credits >= MIN_CREDITS, detail:st?`Tienes ${st.credits}%`:''},
      {k:'programa', label:'Programa asignado', done:!!prog, detail:prog?prog.name:'Se asigna automáticamente'},
      {k:'induccion', label:'Inducción registrada', done:!!exp.induction},
      {k:'solicitud', label:'Solicitud validada', done:okDoc('solicitud'), doc:'solicitud'},
      {k:'carta_compromiso', label:'Carta compromiso validada', done:okDoc('carta_compromiso'), doc:'carta_compromiso'},
      {k:'carta_aceptacion', label:'Carta de aceptación validada', done:okDoc('carta_aceptacion'), doc:'carta_aceptacion'}
    ],
    desarrollo:[
      {k:'plan', label:'Plan de trabajo validado', done:okDoc('plan_trabajo'), doc:'plan_trabajo', due:exp.planDue},
      {k:'r1', label:'Reporte bimestral 1 evaluado', done:repOk(1), report:1},
      {k:'r2', label:'Reporte bimestral 2 evaluado', done:repOk(2), report:2},
      {k:'r3', label:'Reporte bimestral 3 evaluado', done:repOk(3), report:3},
      {k:'horas', label:`${REQUIRED_HOURS} horas acumuladas`, done:exp.hours >= REQUIRED_HOURS, detail:`Llevas ${exp.hours}`}
    ],
    cierre:[
      {k:'reporte_final', label:'Reporte final validado', done:okDoc('reporte_final'), doc:'reporte_final'},
      {k:'carta_terminacion', label:'Carta de terminación validada', done:okDoc('carta_terminacion'), doc:'carta_terminacion'},
      {k:'periodo', label:`Periodo mínimo de ${MIN_MONTHS} meses`, done:!!minDate && today() >= minDate, detail:minDate?`Se cumple el ${fmtDate(minDate)}`:'Cuenta desde el inicio'}
    ]
  };
  let stage = 'liberado';
  for(const s of ['inicio','desarrollo','cierre']){ if(groups[s].some(r => !r.done)){ stage = s; break; } }
  const all = [].concat(groups.inicio, groups.desarrollo, groups.cierre);
  return {groups, stage, done:all.filter(r => r.done).length, total:all.length};
}
const reportDue = (exp, n) => exp.start ? addDays(addMonths(exp.start, 2*n), REPORT_GRACE_DAYS) : null;

/* Asigna programa automáticamente: el de su carrera (si lo hay) con más lugares libres */
function autoAssignProgram(exp){
  const st = studentOfExp(exp); if(!st) return null;
  const used = id => db.expedientes.filter(e => e.programId === id && !['liberado','baja'].includes(e.status)).length;
  const fits = db.programs.filter(p => (!p.careers.length || p.careers.includes(st.career)) && used(p.id) < p.cupo);
  if(!fits.length) return null;
  fits.sort((a,b) => (b.careers.length - a.careers.length) || ((b.cupo - used(b.id)) - (a.cupo - used(a.id))));
  return fits[0];
}

let releaseSeq = () => { const n = db.expedientes.filter(e => e.releaseFolio).length + 1; return `CL-${SITE_YEAR}-${String(n).padStart(3,'0')}`; };

/* Corre todas las reglas. Se ejecuta al abrir la página y después de cada acción. */
function runEngine(silent){
  const changes = [];
  db.expedientes.forEach(exp => {
    if(exp.status === 'baja') return;
    const st = studentOfExp(exp); const u = st && userById(st.userId); const name = u ? u.name : 'Estudiante';
    if(exp.status === 'liberado') return;

    // Regla: créditos insuficientes bloquean el expediente
    if(st && st.credits < MIN_CREDITS){
      if(exp.status !== 'observado'){ exp.status = 'observado'; exp.updated = nowISO(); changes.push(1);
        logEvent('estado_expediente', `Expediente de ${name} bloqueado automáticamente: tiene ${st.credits}% de créditos y se requiere ${MIN_CREDITS}%`, exp.id, true);
        notify(u && u.id, `cred-${exp.id}`, `Tu expediente está en espera: necesitas al menos ${MIN_CREDITS}% de créditos (tienes ${st.credits}%).`, 'inicio');
        notify(staffIds(), `cred-staff-${exp.id}`, `${name} no cumple el ${MIN_CREDITS}% de créditos. Revisa su caso.`, 'excepciones');
      }
      return;
    }

    // Regla: asignación automática de programa
    if(!exp.programId){
      const p = autoAssignProgram(exp);
      if(p){ exp.programId = p.id; exp.updated = nowISO(); changes.push(1);
        logEvent('asignacion_programa', `${name} asignado automáticamente a ${p.name}`, exp.id, true);
        notify(u && u.id, `prog-${exp.id}`, `Se te asignó el programa "${p.name}" con ${p.receiver}.`, 'mi-servicio');
      }
    }

    const req = requirements(exp);
    const hasException = db.documents.some(d => d.expId === exp.id && d.exception) || db.reports.some(r => r.expId === exp.id && r.exception);
    const hasObserved = db.documents.some(d => d.expId === exp.id && d.status === 'observado') || db.reports.some(r => r.expId === exp.id && r.status === 'observado');

    // Regla: al completar Inicio se fijan fechas automáticamente
    if(req.stage !== 'inicio' && !exp.start){
      exp.start = today(); exp.end = addMonths(exp.start, MIN_MONTHS); exp.planDue = addDays(exp.start, PLAN_DAYS);
      changes.push(1);
      logEvent('estado_expediente', `Inicio completo para ${name}. Fechas calculadas: plan de trabajo al ${fmtDate(exp.planDue)}, término estimado ${fmtDate(exp.end)}`, exp.id, true);
      notify(u && u.id, `start-${exp.id}`, `¡Comienza tu servicio social! Entrega tu plan de trabajo antes del ${fmtDate(exp.planDue)}.`, 'mi-servicio');
    }

    // Regla: liberación automática con constancia
    if(req.stage === 'liberado'){
      exp.status = 'liberado'; exp.releaseFolio = releaseSeq(); exp.releasedAt = nowISO(); exp.updated = nowISO(); changes.push(1);
      logEvent('estado_expediente', `${name} liberado automáticamente. Constancia ${exp.releaseFolio}`, exp.id, true);
      notify(u && u.id, `lib-${exp.id}`, `¡Tu servicio social quedó liberado! Ya puedes descargar tu constancia ${exp.releaseFolio}.`, 'inicio');
      notify(staffIds(), `lib-staff-${exp.id}`, `${name} completó todos los requisitos y fue liberado automáticamente.`, 'expedientes');
      return;
    }

    // Regla: estado según etapa
    let target = req.stage === 'inicio' ? 'pre_registro' : 'en_proceso';
    if(req.stage === 'cierre' && req.groups.cierre.filter(r => !r.done).every(r => r.k === 'periodo')) target = 'completo';
    if(hasObserved) target = 'observado';
    if(hasException) target = 'pendiente_revision';
    if(exp.status !== target){
      exp.status = target; exp.updated = nowISO(); changes.push(1);
      logEvent('estado_expediente', `Expediente de ${name} pasó a "${EXP_STATUS[target]}" automáticamente`, exp.id, true);
      if(target === 'completo'){
        const r = req.groups.cierre.find(x => x.k === 'periodo');
        notify(u && u.id, `comp-${exp.id}`, `Entregaste todo. Tu liberación será automática al cumplir el periodo mínimo (${r.detail.replace('Se cumple el ','')}).`, 'inicio');
      }
    }

    // Recordatorios programados
    if(u && exp.start){
      const plan = req.groups.desarrollo[0];
      if(!plan.done && exp.planDue){
        const d = daysUntil(exp.planDue);
        if(d < 0) notify(u.id, `plan-late-${exp.id}`, `Tu plan de trabajo venció el ${fmtDate(exp.planDue)}. Entrégalo lo antes posible.`, 'mi-servicio');
        else if(d <= 5) notify(u.id, `plan-soon-${exp.id}`, `Faltan ${plural(d,'día','días')} para entregar tu plan de trabajo.`, 'mi-servicio');
      }
      const next = [1,2,3].find(n => !reportsOfExp(exp.id).some(r => r.period === n && r.status !== 'observado'));
      if(next){
        const due = reportDue(exp, next); const d = daysUntil(due);
        if(d < 0) notify(u.id, `rep-late-${exp.id}-${next}`, `El reporte del bimestre ${next} venció el ${fmtDate(due)}.`, 'mi-servicio');
        else if(d <= 5) notify(u.id, `rep-soon-${exp.id}-${next}`, `Faltan ${plural(d,'día','días')} para entregar el reporte del bimestre ${next}.`, 'mi-servicio');
      }
    }
  });
  if(changes.length && !silent) save();
  return changes.length;
}

/* Revisión automática de un archivo */
async function inspectFile(file){
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 8));
  const ext = file.name.split('.').pop().toLowerCase();
  const isPdf = head[0]===0x25 && head[1]===0x50 && head[2]===0x44 && head[3]===0x46;
  const isPng = head[0]===0x89 && head[1]===0x50 && head[2]===0x4E && head[3]===0x47;
  const isJpg = head[0]===0xFF && head[1]===0xD8 && head[2]===0xFF;
  const realOk = ext === 'pdf' ? isPdf : ext === 'png' ? isPng : (ext === 'jpg' || ext === 'jpeg') ? isJpg : false;
  return {ext, realOk, hash: await sha256(buf)};
}

/* Reglas para documentos. Devuelve {status, notes, checks, exception} */
function evaluateDocument({type, file, info, exp, replacingId, attempts}){
  const req = requirements(exp);
  const checks = []; const reasons = []; let exception = false;
  const formatOk = ALLOWED_EXT.includes(info.ext) && file.size <= MAX_FILE && file.size >= 100;
  checks.push({ok:formatOk, label:'Formato y tamaño permitidos'});
  if(!formatOk) reasons.push(file.size < 100 ? 'El archivo está vacío o dañado.' : file.size > MAX_FILE ? 'El archivo pasa de 5 MB.' : 'Solo se aceptan PDF, JPG o PNG.');
  checks.push({ok:info.realOk, label:'El contenido coincide con el tipo de archivo'});
  if(formatOk && !info.realOk) reasons.push(`El archivo dice ser ${info.ext.toUpperCase()} pero su contenido no lo es. Vuelve a exportarlo o escanearlo.`);
  const dup = db.documents.find(d => d.hash === info.hash && d.id !== replacingId);
  const dupOther = dup && dup.expId !== exp.id;
  checks.push({ok:!dup, label:'Sin duplicados en otros expedientes'});
  if(dupOther){ reasons.push(`El archivo es idéntico al que entregó otro estudiante (${studentNameOfExp(byId('expedientes', dup.expId))}). Requiere revisión del personal.`); exception = true; }
  else if(dup) reasons.push(`Ya entregaste este mismo archivo como "${DOC_TYPES[dup.type]}".`);
  const stageOk = type === 'reporte_bimestral' || STAGE_DOCS[req.stage].includes(type);
  checks.push({ok:stageOk, label:'Corresponde a la etapa actual'});
  if(!stageOk) reasons.push(`"${DOC_TYPES[type]}" no corresponde a tu etapa actual (${STAGE_LABEL[req.stage]}).`);
  if(!MULTI_DOCS.includes(type) && db.documents.some(d => d.expId === exp.id && d.type === type && d.id !== replacingId && ['validado','aprobado'].includes(d.status))){
    reasons.push(`Ya tienes una "${DOC_TYPES[type]}" validada.`);
  }
  if(type === 'otro') return {status:'recibido', notes:'Documento de tipo "Otro": el sistema no puede validarlo solo. Lo revisará el personal.', checks, exception:true};
  if(!reasons.length) return {status:'validado', notes:'Validado automáticamente.', checks, exception:false};
  if(attempts >= MAX_ATTEMPTS && !exception){ exception = true; reasons.push('Es el segundo intento con problemas; se envió también a revisión del personal.'); }
  return {status:'observado', notes:reasons.join(' '), checks, exception};
}

/* Reglas para reportes bimestrales */
function evaluateReport({hours, activities, docResult, attempts}){
  const reasons = []; let exception = false;
  const words = activities.trim().split(/\s+/).filter(Boolean).length;
  if(!(hours > 0)) reasons.push('Las horas deben ser mayores a cero.');
  if(hours > MAX_REPORT_HOURS){ reasons.push(`${hours} horas en un bimestre supera el máximo razonable (${MAX_REPORT_HOURS}). Requiere revisión del personal.`); exception = true; }
  if(activities.trim().length < 40 || words < 8) reasons.push('Describe tus actividades con más detalle (al menos 8 palabras).');
  if(docResult.status !== 'validado') reasons.push('El formato firmado tiene problemas: ' + docResult.notes);
  if(!reasons.length) return {status:'evaluado', note:'Evaluado automáticamente: horas dentro del rango, actividades descritas y formato válido.', exception:false};
  if(attempts >= MAX_ATTEMPTS && !exception){ exception = true; reasons.push('Segundo intento con problemas; se envió a revisión del personal.'); }
  return {status:'observado', note:reasons.join(' '), exception};
}

/* ---------- Sesión ---------- */
function me(){ const id = Number(sessionStorage.getItem(SESSION_KEY)); return id ? userById(id) : null; }
function can(...roles){ const u = me(); return !!u && roles.includes(u.role); }

/* ---------- Avisos emergentes ---------- */
function toast(msg, type='success'){
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'success' ? '' : type);
  el.textContent = msg;
  const box = $('#toasts'); while(box.children.length >= 3) box.firstChild.remove();
  box.appendChild(el);
  setTimeout(() => el.remove(), 5200);
}

/* ---------- Rutas ---------- */
const unread = () => db.notifications.filter(n => n.userId === me()?.id && !n.read).length;
const ROUTES = {
  inicio:{ label:'Inicio', roles:['admin','student','supervisor'], render:pageHome },
  'mi-servicio':{ label:'Mi servicio social', roles:['student'], render:pageMyFile },
  excepciones:{ label:'Excepciones', roles:['admin','supervisor'], render:pageExceptions, count:exceptionCount },
  expedientes:{ label:'Expedientes', roles:['admin','supervisor'], render:pageFiles },
  estudiantes:{ label:'Estudiantes', roles:['admin'], render:pageStudents },
  avisos:{ label:'Avisos', roles:['admin','student','supervisor'], render:pageNotices, count:unread },
  bitacora:{ label:'Bitácora', roles:['admin','student','supervisor'], render:pageLog }
};
const routeName = () => (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'inicio';
const go = r => { if(location.hash === '#/' + r) render(); else location.hash = '#/' + r; };
let ui = { docFilter:'excepciones' };

function render(){
  const u = me();
  const app = $('#app');
  if(!u){ app.innerHTML = pageLogin(); $('#email')?.focus(); return; }
  let r = routeName();
  if(r === 'login' || !ROUTES[r] || !ROUTES[r].roles.includes(u.role)) r = 'inicio';
  const route = ROUTES[r];
  const body = route.render(u);   // se calcula antes de las pestañas (Avisos marca como leídos)
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
    <main class="folder-body"><div class="folder-wrap"><div class="sheet">${body}</div></div></main>
    <footer class="foot">
      <span>Prototipo académico ${SITE_YEAR}. Datos ficticios; no está conectado al SII ni emite constancias oficiales.</span>
      <button data-click="reset">Restablecer datos de demostración</button>
    </footer>`;
  document.title = `${route.label} | NexoTec Servicio Social`;
}

/* ---------- Página: acceso ---------- */
function pageLogin(){
  const demo = [
    ['alumno@demo.local','Estudiante en desarrollo','Ana Lucía: 120 horas y un documento observado'],
    ['jorge@demo.local','Estudiante a punto de liberarse','Jorge: entrega su carta de terminación y se libera solo'],
    ['supervisor@demo.local','Supervisión','Atiende solo las excepciones'],
    ['admin@demo.local','Administración','Registra estudiantes; el sistema hace el resto']
  ];
  return `
  <div class="login">
    <section class="login-hero">
      <div class="brand"><span class="seal" aria-hidden="true">NT</span><div><div class="brand-name">NexoTec</div><div class="brand-sub">Servicio social, TecNM Campus Matehuala</div></div></div>
      <div>
        <h1>Tu servicio social, sin vueltas a ventanilla.</h1>
        <p class="lead">Entregas tus documentos y el sistema los revisa al momento, calcula tus fechas, te avisa lo que sigue y te libera cuando cumples todo.</p>
      </div>
      <div class="folder" aria-hidden="true">
        <div class="folder-back"></div>
        <div class="folder-sheet"><div class="line" style="width:60%"></div><div class="line" style="width:85%"></div><div class="line" style="width:70%"></div></div>
        <div class="folder-front">
          <div class="folder-label">Expediente<b>22010001</b>Servicio social ${SITE_YEAR}</div>
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
            ${demo.map(([e,r,d]) => `<button type="button" class="demo-btn" data-click="fill" data-email="${e}"><span><b>${r}</b><small>${d}</small></span></button>`).join('')}
          </div>
        </div>
        <p class="fine">Prototipo académico con datos ficticios. La información se guarda solo en este navegador.</p>
      </div>
    </section>
  </div>`;
}

/* ---------- Componentes ---------- */
function hoursRuler(hours){
  const pct = Math.min(100, (hours / REQUIRED_HOURS) * 100);
  return `<div class="ruler" role="img" aria-label="${hours} de ${REQUIRED_HOURS} horas">
    <div class="ruler-top"><b>${hours} <small>de ${REQUIRED_HOURS} horas</small></b><span>${Math.round(pct)}%</span></div>
    <div class="ruler-bar"><div class="ruler-fill" style="width:${pct}%"></div></div>
    <div class="ruler-scale"><span>0</span><span>100</span><span>200</span><span>300</span><span>400</span><span>500</span></div>
  </div>`;
}

function checklist(exp, compact){
  const req = requirements(exp);
  const order = ['inicio','desarrollo','cierre'];
  const cur = order.indexOf(req.stage);
  return `<div class="stages">${order.map((s,i) => {
    const items = req.groups[s]; const done = items.filter(r => r.done).length;
    const state = i < cur || req.stage === 'liberado' ? 'done' : i === cur ? 'now' : '';
    return `<div class="stage ${state}">
      <span class="n">${state==='done'?'✓':i+1}</span>
      <span class="state">${done} de ${items.length}</span>
      <h3>${STAGE_LABEL[s]}</h3>
      <ul class="reqs">${items.map(r => `<li class="${r.done?'ok':''}"><span aria-hidden="true">${r.done?'✓':'○'}</span><span>${esc(r.label)}${r.detail && !compact?`<small>${esc(r.detail)}</small>`:''}</span></li>`).join('')}</ul>
    </div>`; }).join('')}</div>`;
}

function nextSteps(exp){
  if(!exp) return ['Acude a la oficina de Servicio Social para abrir tu expediente.'];
  if(exp.status === 'liberado') return [`Tu servicio social está liberado. Descarga tu constancia ${esc(exp.releaseFolio)}.`];
  if(exp.status === 'baja') return ['Tu expediente está dado de baja. Comunícate con la oficina de Servicio Social.'];
  const out = [];
  docsOfExp(exp.id).filter(d => d.status === 'observado' && !d.exception).forEach(d => out.push(`Corrige <b>${esc(DOC_TYPES[d.type])}</b>: ${esc(d.notes)}`));
  reportsOfExp(exp.id).filter(r => r.status === 'observado' && !r.exception).forEach(r => out.push(`Corrige el <b>reporte del bimestre ${r.period}</b>: ${esc(r.note)}`));
  const req = requirements(exp);
  if(req.stage !== 'liberado'){
    req.groups[req.stage].filter(r => !r.done).forEach(r => {
      if(r.k === 'creditos') out.push(`Necesitas al menos ${MIN_CREDITS}% de créditos para iniciar.`);
      else if(r.k === 'induccion') out.push('Registra tu asistencia a la inducción en "Mi servicio social".');
      else if(r.doc && !docsOfExp(exp.id).some(d => d.type === r.doc && d.status !== 'rechazado')) out.push(`Entrega tu <b>${esc(DOC_TYPES[r.doc])}</b>${r.due?` antes del <b>${fmtDate(r.due)}</b>`:''}.`);
      else if(r.report && !reportsOfExp(exp.id).some(x => x.period === r.report)) out.push(`Envía tu reporte del bimestre ${r.report}${exp.start?`; vence el <b>${fmtDate(reportDue(exp, r.report))}</b>`:''}.`);
      else if(r.k === 'periodo') out.push(`Tu liberación será automática el <b>${r.detail.replace('Se cumple el ','')}</b>.`);
    });
  }
  const pend = docsOfExp(exp.id).filter(d => d.exception).length + reportsOfExp(exp.id).filter(r => r.exception).length;
  if(pend) out.push(`${plural(pend,'entrega está','entregas están')} en revisión con el personal. Te avisaremos del resultado.`);
  return out.length ? out.slice(0, 5) : ['Estás al día. No tienes entregas pendientes.'];
}

/* ---------- Página: inicio ---------- */
function pageHome(u){ return u.role === 'student' ? homeStudent(u) : homeStaff(u); }

function homeStudent(u){
  const st = studentOfUser(u.id); const exp = st && expOfStudent(st.id);
  const prog = exp && byId('programs', exp.programId);
  const req = exp && requirements(exp);
  return `
  <div class="hello">
    <div>
      <h1>Hola, ${esc(firstName(u.name))}</h1>
      <p>${prog ? `Prestas tu servicio en <b>${esc(prog.name)}</b> con ${esc(prog.receiver)}.` : 'El sistema te asignará un programa en cuanto cumplas los requisitos.'}</p>
    </div>
    ${exp ? stamp(exp.status, true) : ''}
  </div>
  ${exp && exp.status === 'liberado' ? `<div class="release">
      <div><h2>Servicio social liberado</h2><p>Constancia ${esc(exp.releaseFolio)}, emitida el ${fmtDate(exp.releasedAt)}.</p></div>
      <button class="btn primary" data-click="constancia" data-id="${exp.id}">Descargar constancia</button></div>`
    : `<div class="next"><h3>Lo que sigue</h3><ul>${nextSteps(exp).map(s => `<li>${s}</li>`).join('')}</ul></div>`}

  <div class="section grid-2-1">
    <div>
      <div class="section-head"><h2>Horas acumuladas</h2><p>Se suman cuando el sistema evalúa cada reporte.</p></div>
      ${hoursRuler(exp ? exp.hours : 0)}
    </div>
    <div>
      <div class="section-head"><h2>Tu avance</h2><a href="#/mi-servicio">Abrir expediente</a></div>
      ${req ? `<p class="big-frac"><b>${req.done}</b> de ${req.total} requisitos cumplidos</p><p class="notice">Etapa actual: ${STAGE_LABEL[req.stage]}.</p>` : ''}
    </div>
  </div>

  ${exp ? `<div class="section">
    <div class="section-head"><h2>Requisitos por etapa</h2><p>El sistema los marca solo conforme se cumplen.</p></div>
    ${checklist(exp)}
  </div>` : ''}`;
}

function homeStaff(u){
  const x = exceptions();
  const active = db.expedientes.filter(e => !['liberado','baja'].includes(e.status)).length;
  const released = db.expedientes.filter(e => e.status === 'liberado').length;
  const decisions = db.events.filter(e => ['revision_documento','evaluacion_reporte','estado_expediente','asignacion_programa'].includes(e.type));
  const autoN = decisions.filter(e => e.auto).length;
  const pct = decisions.length ? Math.round(autoN / decisions.length * 100) : 0;
  const ev = db.events.slice().sort((a,b) => b.created.localeCompare(a.created)).slice(0,6);
  const tray = [
    [x.docs.length, 'Documentos que el sistema no pudo resolver', 'Duplicados, tipo "Otro" o segundo intento fallido', 'excepciones'],
    [x.reports.length, 'Reportes con horas fuera de rango', `Más de ${MAX_REPORT_HOURS} horas o segundo intento fallido`, 'excepciones'],
    [x.blocked.length, 'Expedientes bloqueados por créditos', `Menos de ${MIN_CREDITS}% de créditos`, 'excepciones']
  ];
  return `
  <div class="page-head">
    <div><h1>Resumen del servicio social</h1>
    <p>${plural(db.students.length,'estudiante registrado','estudiantes registrados')}, ${plural(active,'expediente activo','expedientes activos')} y ${plural(released,'servicio liberado','servicios liberados')}.</p></div>
    ${u.role==='admin' ? '<a class="btn primary" href="#/estudiantes">Registrar estudiante</a>' : ''}
  </div>
  <div class="auto-meter">
    <div><b>${pct}%</b><span>de las decisiones las tomó el sistema</span></div>
    <div class="meter" role="img" aria-label="${autoN} de ${decisions.length} decisiones automáticas"><span style="width:${pct}%"></span></div>
    <p>${autoN} automáticas y ${decisions.length - autoN} manuales: validación de documentos, evaluación de reportes, asignación de programa y cambios de etapa.</p>
  </div>
  <div class="section grid-2-1">
    <div>
      <div class="section-head"><h2>Lo que necesita a una persona</h2><p>Todo lo demás lo resuelve el sistema.</p></div>
      <div class="tray">${tray.map(([n,t,s,r]) => `<a href="#/${r}"><span class="num ${n?'':'zero'}">${n}</span><span><b>${t}</b><small>${s}</small></span><span class="go">Atender</span></a>`).join('')}</div>
    </div>
    <div>
      <div class="section-head"><h2>Actividad reciente</h2><a href="#/bitacora">Ver bitácora</a></div>
      ${ev.length ? `<ul class="log">${ev.map(logItem).join('')}</ul>` : '<div class="empty">Sin movimientos todavía.</div>'}
    </div>
  </div>`;
}

/* ---------- Documentos ---------- */
function docRow(d, opts={}){
  const ext = (d.name.split('.').pop() || '').toUpperCase().slice(0,4);
  const editable = opts.student && EDITABLE_DOC.includes(d.status) && !d.exception && d.type !== 'reporte_bimestral';
  const checks = (d.checks || []).length ? `<ul class="checks">${d.checks.map(c => `<li class="${c.ok?'ok':'no'}"><span aria-hidden="true">${c.ok?'✓':'✕'}</span>${esc(c.label)}</li>`).join('')}</ul>` : '';
  const reviewer = d.reviewed ? (d.auto && !d.reviewedBy ? 'revisado por el sistema' : `revisado por ${esc(userById(d.reviewedBy)?.name || 'el personal')}`) : '';
  return `<div class="doc">
    <span class="doc-ico" aria-hidden="true">${esc(ext)}</span>
    <div class="doc-main">
      <b>${esc(DOC_TYPES[d.type] || d.type)}${d.period?`, ${esc(d.period)}`:''}</b>
      <div class="doc-meta">${esc(d.name)}${d.size?`, ${fmtSize(d.size)}`:''}. Folio ${esc(d.folio)}</div>
      ${opts.showStudent ? `<div class="doc-meta">${esc(opts.showStudent)}</div>` : ''}
      <div class="doc-meta">Entregado el ${fmtDateTime(d.created)}${reviewer?`; ${reviewer}`:''}</div>
      ${d.notes ? `<div class="doc-note ${['observado','rechazado'].includes(d.status)||d.exception?'warn':''}">${esc(d.notes)}</div>` : ''}
      ${checks}
    </div>
    <div class="doc-side">
      ${stamp(d.status)}${d.exception?'<span class="flag">Con el personal</span>':''}
      <div class="doc-actions"><button class="btn small" data-click="download" data-id="${d.id}">Descargar</button></div>
    </div>
    ${editable ? `<details class="edit"><summary>Corregir este documento</summary>
      <form class="form" data-action="updateDoc" data-id="${d.id}">
        <label class="field">Archivo corregido <span class="hint">PDF, JPG o PNG hasta 5 MB. Se revisa al instante.</span><input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" required></label>
        <div class="form-end"><button class="btn primary small">Reenviar</button></div>
      </form></details>` : ''}
    ${opts.review ? opts.review : ''}
  </div>`;
}

/* ---------- Página: mi servicio social (estudiante) ---------- */
function pageMyFile(u){
  const st = studentOfUser(u.id); const exp = st && expOfStudent(st.id);
  if(!exp) return `<div class="empty"><b>Aún no tienes expediente.</b>Acude a la oficina de Servicio Social para que lo abran.</div>`;
  const prog = byId('programs', exp.programId);
  const docs = docsOfExp(exp.id).filter(d => d.type !== 'reporte_bimestral'); const reps = reportsOfExp(exp.id);
  const req = requirements(exp);
  const allowed = STAGE_DOCS[req.stage];
  const nextDoc = allowed.find(t => t !== 'otro' && !docsOfExp(exp.id).some(d => d.type === t && d.status !== 'rechazado' && d.status !== 'observado')) || allowed[0];
  const nextRep = [1,2,3].find(n => !reps.some(r => r.period === n && r.status !== 'observado'));
  const redo = nextRep && reps.find(r => r.period === nextRep && r.status === 'observado');
  const waiting = redo && redo.exception;
  const canReport = req.stage === 'desarrollo' && !!exp.start && nextRep && !waiting;
  return `
  <div class="page-head">
    <div><h1>Mi expediente</h1><p>Número de control ${esc(st.control)}, ${esc(st.career)}.</p></div>
    ${stamp(exp.status, true)}
  </div>
  <dl class="facts">
    <div class="fact"><dt>Programa receptor</dt><dd>${esc(prog ? prog.name : 'Se asigna automáticamente')}</dd></div>
    <div class="fact"><dt>Fecha de inicio</dt><dd>${exp.start ? fmtDate(exp.start) : 'Al completar Inicio'}</dd></div>
    <div class="fact"><dt>Término estimado</dt><dd>${exp.end ? fmtDate(exp.end) : 'Se calcula solo'}</dd></div>
    <div class="fact"><dt>Plan de trabajo, fecha límite</dt><dd>${exp.planDue ? fmtDate(exp.planDue) : 'Se calcula solo'}</dd></div>
    <div class="fact"><dt>Inducción</dt><dd>${exp.induction ? 'Registrada el ' + fmtDate(exp.inductionDate) : `<button class="btn small" data-click="induction">Ya tomé la inducción</button>`}</dd></div>
    <div class="fact"><dt>Créditos</dt><dd>${st.credits}%</dd></div>
  </dl>

  <div class="section">${hoursRuler(exp.hours)}</div>

  <div class="section grid-2-1">
    <div>
      <div class="section-head"><h2>Documentos entregados</h2><p>Cada archivo se revisa en cuanto lo entregas.</p></div>
      ${docs.length ? `<div class="docs">${docs.map(d => docRow(d, {student:true})).join('')}</div>`
        : '<div class="empty"><b>Todavía no entregas documentos.</b>Empieza con tu solicitud usando el formulario.</div>'}
    </div>
    <div>
      ${exp.status === 'liberado' ? `<div class="box tint"><h3>Servicio liberado</h3><p class="notice">Ya no necesitas entregar nada.</p><button class="btn primary full" style="margin-top:14px" data-click="constancia" data-id="${exp.id}">Descargar constancia</button></div>` : `
      <div class="box tint">
        <h3 style="margin-bottom:4px">Entregar un documento</h3>
        <p class="notice" style="margin:0 0 16px">Etapa ${STAGE_LABEL[req.stage]}. El folio y la fecha se asignan solos; la revisión toma un segundo.</p>
        <form class="form" data-action="uploadDoc">
          <label class="field">Tipo de documento<select name="type" required>${options(DOC_TYPES, nextDoc, allowed)}</select></label>
          <label class="field">Archivo <span class="hint">PDF, JPG o PNG de hasta 5 MB.</span><input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" required></label>
          <button class="btn primary full">Entregar documento</button>
        </form>
      </div>`}
    </div>
  </div>

  <div class="section">
    <div class="section-head"><h2>Reportes bimestrales</h2><p>Cada reporte evaluado suma sus horas a tu total.</p></div>
    ${reps.length ? `<div class="table-wrap" style="margin-bottom:24px"><table>
      <thead><tr><th>Periodo</th><th>Actividades</th><th>Horas</th><th>Estado</th><th>Vencía</th><th>Enviado</th></tr></thead>
      <tbody>${reps.map(r => `<tr><td><b>Bimestre ${r.period}</b></td><td>${esc(r.activities)}${r.note?`<small>${esc(r.note)}</small>`:''}</td><td>${r.hours}</td><td>${stamp(r.status)}${r.exception?'<span class="flag">Con el personal</span>':''}</td><td>${fmtDate(r.due)}</td><td>${fmtDateTime(r.submitted)}${r.due && r.submitted.slice(0,10) > r.due ? '<small>Con retraso</small>' : ''}</td></tr>`).join('')}</tbody>
    </table></div>` : ''}
    ${canReport ? `<form class="form cols" data-action="createReport">
      <input type="hidden" name="period" value="${nextRep}">
      <div class="field span"><b>${redo ? 'Corregir' : 'Enviar'} reporte del bimestre ${nextRep}</b><span class="hint">Vence el ${fmtDate(reportDue(exp, nextRep))}.</span></div>
      <label class="field">Horas del periodo<input type="number" name="hours" min="1" max="500" step="0.5" required value="${redo?redo.hours:''}"></label>
      <label class="field">Formato firmado <span class="hint">PDF, JPG o PNG.</span><input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" required></label>
      <label class="field span">Actividades realizadas<textarea name="activities" rows="3" required placeholder="Describe lo que hiciste en el periodo, al menos 8 palabras.">${redo?esc(redo.activities):''}</textarea></label>
      <div class="form-end"><button class="btn primary">${redo ? 'Reenviar reporte' : 'Enviar reporte'}</button></div>
    </form>` : `<div class="empty">${waiting ? `<b>Tu reporte del bimestre ${nextRep} está con el personal.</b>Te avisaremos cuando lo revisen.` : req.stage === 'inicio' ? '<b>Los reportes se habilitan al terminar la etapa de Inicio.</b>' : !nextRep ? '<b>Ya entregaste los tres reportes bimestrales.</b>' : '<b>No hay reportes por enviar en esta etapa.</b>'}</div>`}
  </div>`;
}

/* ---------- Página: excepciones (personal) ---------- */
function pageExceptions(u){
  const x = exceptions();
  const docOpts = u.role === 'admin' ? {validado:'Validar', observado:'Pedir corrección', rechazado:'Rechazar', aprobado:'Aprobar oficialmente'} : {validado:'Validar', observado:'Pedir corrección', rechazado:'Rechazar'};
  const reviewForm = d => `<details class="edit" open><summary>Resolver</summary>
      <form class="form cols" data-action="reviewDoc" data-id="${d.id}">
        <label class="field">Resultado<select name="status">${options(docOpts, 'validado')}</select></label>
        <label class="field span">Motivo u observación<input name="notes" required placeholder="Lo verá el estudiante"></label>
        <div class="form-end"><button class="btn primary small">Registrar decisión</button></div>
      </form></details>`;
  const who = d => { const exp = byId('expedientes', d.expId); const s = exp && studentOfExp(exp); return exp ? `${studentNameOfExp(exp)}, control ${s?s.control:''}` : ''; };
  const f = ui.docFilter;
  const chip = (k, l) => `<button class="chip" data-click="filter" data-f="${k}" aria-pressed="${f===k}">${l}</button>`;
  let list = '';
  if(f === 'excepciones'){
    const parts = [];
    if(x.docs.length) parts.push(`<div class="section-head"><h2>Documentos</h2></div><div class="docs">${x.docs.map(d => docRow(d, {showStudent:who(d), review:reviewForm(d)})).join('')}</div>`);
    if(x.reports.length) parts.push(`<div class="section"><div class="section-head"><h2>Reportes</h2></div><div class="table-wrap"><table>
      <thead><tr><th>Estudiante</th><th>Periodo</th><th>Horas</th><th>Motivo</th><th>Resolver</th></tr></thead>
      <tbody>${x.reports.map(r => { const exp = byId('expedientes', r.expId); return `<tr>
        <td><b>${esc(studentNameOfExp(exp))}</b><small>${esc(r.activities)}</small></td><td>Bimestre ${r.period}</td><td><b>${r.hours}</b></td><td><small>${esc(r.note)}</small></td>
        <td><form class="inline" data-action="reviewReport" data-id="${r.id}">
          <select name="status" aria-label="Resultado"><option value="evaluado">Aceptar horas</option><option value="observado">Pedir corrección</option></select>
          <input name="notes" required placeholder="Observación" aria-label="Observación"><button class="btn small">Registrar</button></form></td></tr>`; }).join('')}</tbody></table></div></div>`);
    if(x.blocked.length) parts.push(`<div class="section"><div class="section-head"><h2>Expedientes bloqueados por créditos</h2><p>Si los créditos se actualizaron, corrígelos y el sistema lo desbloquea solo.</p></div><div class="table-wrap"><table>
      <thead><tr><th>Estudiante</th><th>Créditos actuales</th><th>Actualizar créditos</th></tr></thead>
      <tbody>${x.blocked.map(e => { const s = studentOfExp(e); return `<tr><td><b>${esc(studentNameOfExp(e))}</b><small>${esc(s.control)}, ${esc(s.career)}</small></td><td><span class="pct low">${s.credits}%</span></td>
        <td><form class="inline" data-action="updateCredits" data-id="${s.id}"><input type="number" name="credits" min="0" max="100" step="0.01" value="${s.credits}" aria-label="Créditos" style="max-width:120px"><button class="btn small">Guardar</button></form></td></tr>`; }).join('')}</tbody></table></div></div>`);
    list = parts.join('') || `<div class="empty"><b>No hay excepciones.</b>El sistema está resolviendo todo solo.</div>`;
  } else {
    const rows = db.documents.slice().sort((a,b) => b.created.localeCompare(a.created));
    list = `<p class="notice" style="margin-bottom:12px">Puedes corregir cualquier decisión del sistema. Tu decisión queda en la bitácora como manual.</p>
      <div class="docs">${rows.map(d => docRow(d, {showStudent:who(d), review:reviewForm(d).replace(' open','').replace('Resolver','Cambiar decisión')})).join('')}</div>`;
  }
  return `
  <div class="page-head"><div><h1>Excepciones</h1><p>Solo llega aquí lo que el sistema no puede decidir solo: archivos duplicados, documentos de tipo "Otro", horas fuera de rango, segundos intentos fallidos y créditos insuficientes.</p></div></div>
  <div class="filters" role="group" aria-label="Vista">${chip('excepciones','Por resolver')}${chip('todos','Todos los documentos')}</div>
  ${list}`;
}

/* ---------- Página: expedientes ---------- */
function pageFiles(u){
  const rows = db.expedientes.slice().sort((a,b) => (b.updated||'').localeCompare(a.updated||''));
  return `
  <div class="page-head"><div><h1>Expedientes</h1><p>El estado de cada expediente lo calcula el sistema a partir de sus requisitos. Aquí solo das de baja, reactivas${u.role==='admin'?' o liberas manualmente un caso especial':''}.</p></div></div>
  <div class="table-wrap"><table>
    <thead><tr><th>Estudiante</th><th>Programa</th><th>Avance</th><th>Horas</th><th>Estado</th><th>Acciones</th></tr></thead>
    <tbody>${rows.map(e => { const s = studentOfExp(e); const p = byId('programs', e.programId); const req = requirements(e); return `<tr>
      <td><b>${esc(studentNameOfExp(e))}</b><small>${esc(s?s.control:'')}</small></td>
      <td>${esc(p?p.name:'Sin asignar')}${e.releaseFolio?`<small>Constancia ${esc(e.releaseFolio)}</small>`:''}</td>
      <td style="min-width:200px"><b>${req.done} de ${req.total}</b><small>Etapa: ${STAGE_LABEL[req.stage]}</small>
        <details class="mini"><summary>Ver requisitos</summary>${checklist(e, true)}</details></td>
      <td style="white-space:nowrap"><b>${e.hours} / ${REQUIRED_HOURS}</b></td>
      <td>${stamp(e.status)}</td>
      <td><div class="inline" style="min-width:180px">
        ${e.status === 'baja' ? `<button class="btn small" data-click="reactivate" data-id="${e.id}">Reactivar</button>` : e.status !== 'liberado' ? `<button class="btn small" data-click="drop" data-id="${e.id}">Dar de baja</button>` : ''}
        ${u.role === 'admin' && !['liberado','baja'].includes(e.status) ? `<button class="btn small ghost" data-click="forceRelease" data-id="${e.id}">Liberar manualmente</button>` : ''}
        ${e.status === 'liberado' ? `<button class="btn small" data-click="constancia" data-id="${e.id}">Constancia</button>` : ''}
      </div></td></tr>`; }).join('')}</tbody>
  </table></div>`;
}

/* ---------- Página: estudiantes (admin) ---------- */
function pageStudents(){
  const rows = db.students.slice().sort((a,b) => (b.created||'').localeCompare(a.created||''));
  return `
  <div class="page-head"><div><h1>Estudiantes</h1><p>Al registrar a alguien, el sistema revisa sus créditos, le asigna programa según su carrera y cupo, y le abre su expediente.</p></div></div>
  <div class="table-wrap"><table>
    <thead><tr><th>Estudiante</th><th>Número de control</th><th>Carrera</th><th>Semestre</th><th>Créditos</th><th>Expediente</th></tr></thead>
    <tbody>${rows.map(s => { const u = userById(s.userId); const e = expOfStudent(s.id); return `<tr>
      <td><b>${esc(u?u.name:'Sin usuario')}</b><small>${esc(u?u.email:'')}</small></td>
      <td>${esc(s.control)}</td><td>${esc(s.career)}</td><td>${s.semester}</td>
      <td><span class="pct ${s.credits<MIN_CREDITS?'low':''}">${s.credits}%</span></td>
      <td>${e?stamp(e.status):'—'}</td></tr>`; }).join('')}</tbody>
  </table></div>

  <div class="section">
    <div class="section-head"><h2>Registrar estudiante</h2><p>La contraseña temporal se la compartes al estudiante.</p></div>
    <form class="form cols" data-action="createStudent">
      <label class="field">Nombre completo<input name="name" required></label>
      <label class="field">Correo electrónico<input type="email" name="email" required></label>
      <label class="field">Contraseña temporal<input name="password" value="cambiar123" required minlength="6"></label>
      <label class="field">Número de control<input name="control" required pattern="[0-9A-Za-z]{6,12}" title="Entre 6 y 12 letras o números"></label>
      <label class="field">Carrera<select name="career">${['Ingeniería en Sistemas Computacionales','Ingeniería Industrial','Ingeniería en Gestión Empresarial','Ingeniería Electromecánica','Ingeniería Civil'].map(c => `<option>${c}</option>`).join('')}</select></label>
      <label class="field">Semestre<input type="number" name="semester" min="1" max="15" value="7" required></label>
      <label class="field">Porcentaje de créditos<input type="number" name="credits" min="0" max="100" step="0.01" value="70" required></label>
      <div class="form-end"><button class="btn primary">Registrar y abrir expediente</button></div>
    </form>
  </div>`;
}

/* ---------- Página: avisos ---------- */
function pageNotices(u){
  const rows = db.notifications.filter(n => n.userId === u.id).sort((a,b) => b.created.localeCompare(a.created));
  const html = rows.length ? `<ul class="notices">${rows.map(n => `<li class="${n.read?'':'unread'}"><div><b>${esc(n.msg)}</b><small>${fmtDateTime(n.created)}</small></div>${n.link?`<a href="#/${n.link}">Ver</a>`:''}</li>`).join('')}</ul>`
    : '<div class="empty"><b>No tienes avisos.</b>Aquí aparecerán los resultados de tus revisiones y los recordatorios de fechas.</div>';
  let changed = false; rows.forEach(n => { if(!n.read){ n.read = true; changed = true; } }); if(changed) save();
  return `<div class="page-head"><div><h1>Avisos</h1><p>El sistema te avisa cuando revisa algo tuyo y te recuerda las fechas que se acercan.</p></div></div>${html}`;
}

/* ---------- Página: bitácora ---------- */
function logItem(e){
  const u = e.userId ? userById(e.userId) : null;
  return `<li class="${e.auto?'auto':''}"><b>${esc(e.desc)}</b><small>${e.auto ? 'Sistema, automático' : esc(u?u.name:'Sistema')}, ${fmtDateTime(e.created)}</small></li>`;
}
function pageLog(u){
  let rows = db.events.slice().sort((a,b) => b.created.localeCompare(a.created));
  if(u.role === 'student'){
    const st = studentOfUser(u.id); const ids = db.expedientes.filter(e => st && e.studentId === st.id).map(e => e.id);
    rows = rows.filter(e => ids.includes(e.expId));
  }
  rows = rows.slice(0, 150);
  let html = '', day = '';
  rows.forEach(e => {
    const d = new Date(e.created).toLocaleDateString('es-MX', {weekday:'long', day:'numeric', month:'long'});
    if(d !== day){ if(day) html += '</ul>'; html += `<div class="log-day">${esc(d.charAt(0).toUpperCase()+d.slice(1))}</div><ul class="log">`; day = d; }
    html += logItem(e);
  });
  if(day) html += '</ul>';
  return `<div class="page-head"><div><h1>Bitácora</h1><p>${u.role==='student'?'Movimientos de tu expediente.':'Todo lo que ha pasado en el portal. Los puntos rellenos son decisiones automáticas.'}</p></div></div>
    ${html || '<div class="empty">Sin movimientos todavía.</div>'}`;
}

/* ---------- Acciones de formularios ---------- */
function myExp(){ const st = studentOfUser(me().id); return st && expOfStudent(st.id); }
let folioSeq = () => `SS-${SITE_YEAR}-${String(db.documents.length + 1).padStart(3,'0')}`;

async function storeDocument({exp, type, file, period, replacing, attempts}){
  const info = await inspectFile(file);
  const result = evaluateDocument({type, file, info, exp, replacingId:replacing?.id, attempts});
  const key = 'doc-' + Date.now() + '-' + Math.random().toString(36).slice(2,7);
  await Files.put(key, file);
  let d = replacing;
  if(d){ if(d.fileKey) Files.del(d.fileKey).catch(()=>{}); }
  else { d = {id:nextId('documents'), expId:exp.id, type, folio:folioSeq(), uploadedBy:me().id}; db.documents.push(d); }
  Object.assign(d, {name:file.name, fileKey:key, size:file.size, mime:file.type, hash:info.hash, period:period||d.period||'',
    date:new Date(file.lastModified || Date.now()).toISOString().slice(0,10), status:result.status, notes:result.notes, checks:result.checks,
    auto:true, exception:result.exception, attempts, reviewedBy:null, created:nowISO(), reviewed:result.status==='recibido'?null:nowISO()});
  return d;
}

function announceDoc(d, exp){
  const name = studentNameOfExp(exp); const label = DOC_TYPES[d.type];
  const u = userOfExp(exp);
  if(d.status === 'validado'){ logEvent('revision_documento', `${label} de ${name} validado automáticamente`, exp.id, true); notify(u?.id, `doc-ok-${d.id}-${d.created}`, `Se validó tu documento "${label}".`, 'mi-servicio'); }
  else if(d.status === 'observado'){ logEvent('revision_documento', `${label} de ${name} observado automáticamente: ${d.notes}`, exp.id, true); notify(u?.id, `doc-obs-${d.id}-${d.created}`, `Tu documento "${label}" tiene observaciones: ${d.notes}`, 'mi-servicio'); }
  if(d.exception){ logEvent('excepcion', `${label} de ${name} enviado a revisión del personal`, exp.id, true); notify(staffIds(), `doc-exc-${d.id}-${d.created}`, `${label} de ${name} necesita revisión: ${d.notes}`, 'excepciones'); }
}

const actions = {
  async login(fd){
    const email = String(fd.get('email')||'').trim().toLowerCase();
    const u = db.users.find(x => x.email.toLowerCase() === email && x.active);
    if(!u || u.pass !== await hashPw(String(fd.get('password')||''))){ toast('El correo o la contraseña no coinciden. Revisa e intenta de nuevo.', 'error'); return; }
    sessionStorage.setItem(SESSION_KEY, u.id);
    runEngine();
    const n = db.notifications.filter(x => x.userId === u.id && !x.read).length;
    toast(`Sesión iniciada como ${u.name}.${n ? ` Tienes ${plural(n,'aviso nuevo','avisos nuevos')}.` : ''}`);
    go('inicio');
  },

  async createStudent(fd){
    if(!can('admin')) return;
    const email = String(fd.get('email')).trim().toLowerCase();
    const control = String(fd.get('control')).trim();
    if(db.users.some(u => u.email.toLowerCase() === email)){ toast('Ya existe una cuenta con ese correo.', 'error'); return; }
    if(db.students.some(s => s.control === control)){ toast('Ese número de control ya está registrado.', 'error'); return; }
    const uid = nextId('users'); const name = String(fd.get('name')).trim();
    db.users.push({id:uid, name, email, pass:await hashPw(String(fd.get('password'))), role:'student', active:true});
    const sid = nextId('students');
    db.students.push({id:sid, userId:uid, control, career:String(fd.get('career')), semester:parseInt(fd.get('semester'),10), credits:parseFloat(fd.get('credits')), created:nowISO()});
    const eid = nextId('expedientes');
    db.expedientes.push({id:eid, studentId:sid, programId:null, status:'pre_registro', start:null, end:null, induction:false, inductionDate:null, planDue:null, hours:0, notes:'', releaseFolio:null, releasedAt:null, updated:nowISO()});
    logEvent('alta_estudiante', `Se registró a ${name} (${control})`, eid);
    runEngine(true);
    const e = byId('expedientes', eid); const p = byId('programs', e.programId);
    save();
    toast(e.status === 'observado' ? `Registrado, pero el expediente quedó en espera: tiene menos de ${MIN_CREDITS}% de créditos.` : `Registrado y asignado a ${p ? p.name : 'un programa'}. Puede entrar con ${email}.`, e.status === 'observado' ? 'warn' : 'success');
    render();
  },

  async uploadDoc(fd, form){
    if(!can('student')) return;
    const exp = myExp(); const file = form.querySelector('input[type=file]').files[0];
    if(!exp || !file){ toast('Selecciona un archivo.', 'error'); return; }
    const type = fd.get('type');
    const prev = docsOfExp(exp.id).find(d => d.type === type && d.status === 'observado' && !d.exception);
    let d;
    try{ d = await storeDocument({exp, type, file, replacing:prev, attempts:prev ? (prev.attempts||1) + 1 : 1}); }
    catch(e){ console.error(e); toast('El navegador no permitió guardar el archivo. Libera espacio o usa otro navegador.', 'error'); return; }
    exp.updated = nowISO(); announceDoc(d, exp); runEngine(true); save();
    toast(d.status === 'validado' ? `Documento validado al instante: ${DOC_TYPES[type]}.` : d.exception ? 'Entregado. El personal lo revisará; te avisaremos.' : `Tiene observaciones: ${d.notes}`, d.status === 'validado' ? 'success' : d.exception ? 'warn' : 'error');
    render();
  },

  async updateDoc(fd, form){
    if(!can('student')) return;
    const d = byId('documents', form.dataset.id); const exp = myExp();
    if(!d || !exp || d.expId !== exp.id || !EDITABLE_DOC.includes(d.status)){ toast('Este documento ya fue aceptado y no se puede corregir.', 'error'); return; }
    const file = form.querySelector('input[type=file]').files[0];
    try{ await storeDocument({exp, type:d.type, file, replacing:d, attempts:(d.attempts||1) + 1}); }
    catch(e){ toast('El navegador no permitió guardar el archivo.', 'error'); return; }
    announceDoc(d, exp); runEngine(true); save();
    toast(d.status === 'validado' ? 'Corregido y validado al instante.' : d.exception ? 'Se envió a revisión del personal.' : `Sigue con observaciones: ${d.notes}`, d.status === 'validado' ? 'success' : d.exception ? 'warn' : 'error');
    render();
  },

  async createReport(fd, form){
    if(!can('student')) return;
    const exp = myExp(); if(!exp) return;
    const period = parseInt(fd.get('period'),10); const hours = parseFloat(fd.get('hours'));
    const activities = String(fd.get('activities')||'').trim();
    const file = form.querySelector('input[type=file]').files[0];
    const prev = db.reports.find(r => r.expId === exp.id && r.period === period);
    if(prev && prev.status !== 'observado'){ toast(`Ya enviaste el reporte del bimestre ${period}.`, 'error'); return; }
    const attempts = prev ? (prev.attempts||1) + 1 : 1;
    const prevDoc = prev && byId('documents', prev.docId);
    let doc;
    try{ doc = await storeDocument({exp, type:'reporte_bimestral', file, period:`Bimestre ${period}`, replacing:prevDoc, attempts}); }
    catch(e){ toast('El navegador no permitió guardar el archivo.', 'error'); return; }
    const res = evaluateReport({hours, activities, docResult:doc, attempts});
    if(doc.exception && !res.exception){ res.exception = true; }
    doc.exception = false; // la excepción se maneja en el reporte
    const r = prev || {id:nextId('reports'), expId:exp.id, period};
    Object.assign(r, {activities, hours, status:res.status, note:res.note, due:reportDue(exp, period), submitted:nowISO(), docId:doc.id, auto:true, exception:res.exception, attempts});
    if(!prev) db.reports.push(r);
    const name = studentNameOfExp(exp); const u = userOfExp(exp);
    if(res.status === 'evaluado'){
      exp.hours = Math.round((exp.hours + hours) * 100) / 100;
      logEvent('evaluacion_reporte', `Reporte bimestral ${period} de ${name} evaluado automáticamente (${hours} h)`, exp.id, true);
      notify(u?.id, `rep-ok-${r.id}-${r.submitted}`, `Tu reporte del bimestre ${period} fue evaluado. Se sumaron ${hours} horas.`, 'mi-servicio');
    } else {
      logEvent('evaluacion_reporte', `Reporte bimestral ${period} de ${name} observado automáticamente: ${res.note}`, exp.id, true);
      if(res.exception){ logEvent('excepcion', `Reporte bimestral ${period} de ${name} enviado a revisión del personal`, exp.id, true); notify(staffIds(), `rep-exc-${r.id}-${r.submitted}`, `Reporte ${period} de ${name} necesita revisión: ${res.note}`, 'excepciones'); }
    }
    exp.updated = nowISO(); runEngine(true); save();
    toast(res.status === 'evaluado' ? `Reporte evaluado al instante. Llevas ${exp.hours} horas.` : res.exception ? 'El personal revisará tu reporte; te avisaremos.' : `Tu reporte tiene observaciones: ${res.note}`, res.status === 'evaluado' ? 'success' : res.exception ? 'warn' : 'error');
    render();
  },

  async reviewDoc(fd, form){
    if(!can('admin','supervisor')) return;
    const d = byId('documents', form.dataset.id); if(!d) return;
    let status = fd.get('status');
    const allowed = me().role === 'admin' ? ['validado','observado','rechazado','aprobado'] : ['validado','observado','rechazado'];
    if(!allowed.includes(status)) status = 'observado';
    Object.assign(d, {status, notes:String(fd.get('notes')||'').trim(), reviewedBy:me().id, reviewed:nowISO(), exception:false, auto:false, attempts:status==='observado'?0:d.attempts});
    const exp = byId('expedientes', d.expId);
    logEvent('revision_documento', `${DOC_TYPES[d.type]} de ${studentNameOfExp(exp)}: ${DOC_STATUS[status].toLowerCase()} por revisión manual. ${d.notes}`, d.expId);
    notify(userOfExp(exp)?.id, `doc-man-${d.id}-${d.reviewed}`, `El personal revisó tu documento "${DOC_TYPES[d.type]}": ${DOC_STATUS[status].toLowerCase()}. ${d.notes}`, 'mi-servicio');
    runEngine(true); save(); toast(`Decisión registrada: ${DOC_STATUS[status]}.`); render();
  },

  async reviewReport(fd, form){
    if(!can('admin','supervisor')) return;
    const r = byId('reports', form.dataset.id); if(!r) return;
    const exp = byId('expedientes', r.expId);
    const status = fd.get('status') === 'evaluado' ? 'evaluado' : 'observado';
    if(status === 'evaluado' && r.status !== 'evaluado') exp.hours = Math.round((exp.hours + r.hours) * 100) / 100;
    Object.assign(r, {status, note:String(fd.get('notes')||'').trim(), exception:false, auto:false, attempts:0});
    logEvent('evaluacion_reporte', `Reporte bimestral ${r.period} de ${studentNameOfExp(exp)}: ${REPORT_STATUS[status].toLowerCase()} por revisión manual`, exp.id);
    notify(userOfExp(exp)?.id, `rep-man-${r.id}-${nowISO()}`, `El personal revisó tu reporte del bimestre ${r.period}: ${REPORT_STATUS[status].toLowerCase()}. ${r.note}`, 'mi-servicio');
    runEngine(true); save(); toast('Decisión registrada.'); render();
  },

  async updateCredits(fd, form){
    if(!can('admin','supervisor')) return;
    const s = byId('students', form.dataset.id); if(!s) return;
    s.credits = parseFloat(fd.get('credits'));
    const exp = expOfStudent(s.id);
    if(exp && s.credits >= MIN_CREDITS && exp.status === 'observado') exp.status = 'pre_registro';
    logEvent('actualizacion_creditos', `Créditos de ${userById(s.userId)?.name} actualizados a ${s.credits}%`, exp?.id);
    runEngine(true); save();
    toast(s.credits >= MIN_CREDITS ? 'Créditos actualizados. El sistema desbloqueó el expediente.' : 'Créditos actualizados; sigue sin cumplir el mínimo.', s.credits >= MIN_CREDITS ? 'success' : 'warn');
    render();
  }
};

/* ---------- PDF (constancias y documentos de ejemplo) ---------- */
function buildPdf({kicker, title, rows, paragraphs, stampLabel, stampTone, signature}){
  const pdfStr = s => '(' + String(s).replace(/[^\x20-\xFF]/g, '-').replace(/[\\()]/g, m => '\\' + m) + ')';
  const ops = [];
  const text = (x, y, size, bold, s, rgb='0.11 0.15 0.25') => ops.push(`BT ${rgb} rg /${bold?'F2':'F1'} ${size} Tf ${x} ${y} Td ${pdfStr(s)} Tj ET`);
  ops.push('0.26 0.22 0.66 RG 3 w 72 700 m 540 700 l S');
  text(72, 740, 10, false, kicker);
  text(72, 712, 22, true, title);
  let y = 660;
  rows.forEach(([k, v]) => {
    text(72, y, 10, false, k, '0.35 0.39 0.47'); text(220, y, 12, true, v);
    ops.push(`0.84 0.85 0.89 RG 0.6 w 72 ${y-9} m 540 ${y-9} l S`); y -= 30;
  });
  y -= 20;
  paragraphs.forEach(p => { text(72, y, 11, false, p); y -= 16; });
  const tone = {ok:'0.12 0.48 0.32', warn:'0.64 0.36 0', bad:'0.71 0.14 0.09', ink:'0.26 0.22 0.66', neutral:'0.35 0.39 0.47'}[stampTone||'ink'];
  const label = String(stampLabel).toUpperCase(); const w = label.length * 13 + 36;
  ops.push(`q 0.985 -0.17 0.17 0.985 360 150 cm ${tone} RG 3 w 0 0 ${w} 46 re S 1.2 w 5 5 ${w-10} 36 re S BT ${tone} rg /F2 20 Tf 18 15 Td ${pdfStr(label)} Tj ET Q`);
  ops.push('0.11 0.15 0.25 RG 0.8 w 72 120 m 270 120 l S');
  text(72, 104, 10, false, signature, '0.35 0.39 0.47');
  const stream = ops.join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  ];
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i+1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length+1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10,'0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new Uint8Array(out.length);
  for(let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xFF;
  return new Blob([bytes], {type:'application/pdf'});
}
const KICKER = 'Tecnológico Nacional de México, Campus Matehuala';
function samplePdf(d, exp, st){
  const u = st && userById(st.userId); const prog = exp && byId('programs', exp.programId);
  return buildPdf({kicker:KICKER, title:DOC_TYPES[d.type] || 'Documento',
    rows:[['Estudiante', u?u.name:'—'], ['Número de control', st?st.control:'—'], ['Carrera', st?st.career:'—'], ['Programa', prog?prog.name:'Por asignar'],
      ['Instancia receptora', prog?prog.receiver:'—'], ['Folio', d.folio||'—'], ['Periodo', d.period||'—'], ['Fecha del documento', fmtDate(d.date)]],
    paragraphs:['Este es un documento de ejemplo generado por el prototipo NexoTec.', 'No tiene validez oficial. Los datos son ficticios.'],
    stampLabel:DOC_STATUS[d.status] || d.status, stampTone:TONE[d.status], signature:'Firma del responsable del programa'});
}
function constanciaPdf(exp){
  const st = studentOfExp(exp); const u = userOfExp(exp); const prog = byId('programs', exp.programId);
  return buildPdf({kicker:KICKER, title:'Constancia de liberación de Servicio Social',
    rows:[['Folio', exp.releaseFolio], ['Estudiante', u?u.name:'—'], ['Número de control', st?st.control:'—'], ['Carrera', st?st.career:'—'],
      ['Programa', prog?prog.name:'—'], ['Instancia receptora', prog?prog.receiver:'—'], ['Periodo', `${fmtDate(exp.start)} al ${fmtDate(exp.releasedAt)}`], ['Horas acreditadas', `${exp.hours} horas`]],
    paragraphs:['Se hace constar que la persona mencionada concluyó su Servicio Social cumpliendo', `los requisitos de créditos, horas, reportes y periodo mínimo de ${MIN_MONTHS} meses.`, '', 'Constancia generada automáticamente por el prototipo NexoTec. Sin validez oficial.'],
    stampLabel:'Liberado', stampTone:'ok', signature:'Oficina de Servicio Social'});
}
function downloadBlob(blob, name){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- Acciones de clic ---------- */
const clicks = {
  logout(){ sessionStorage.removeItem(SESSION_KEY); location.hash = '#/login'; render(); },
  fill(btn){ $('#email').value = btn.dataset.email; $('#password').value = 'password'; $('#password').focus(); },
  filter(btn){ ui.docFilter = btn.dataset.f; render(); },
  induction(){
    const exp = myExp(); if(!exp || exp.induction) return;
    exp.induction = true; exp.inductionDate = today(); exp.updated = nowISO();
    logEvent('induccion', `${studentNameOfExp(exp)} registró su inducción`, exp.id);
    runEngine(true); save(); toast('Inducción registrada.'); render();
  },
  async download(btn){
    const d = byId('documents', btn.dataset.id); const u = me(); if(!d || !u) return;
    const exp = byId('expedientes', d.expId); const st = exp && studentOfExp(exp);
    if(u.role === 'student' && !(st && st.userId === u.id)){ toast('Solo puedes descargar documentos de tu propio expediente.', 'error'); return; }
    let blob = d.fileKey ? await Files.get(d.fileKey).catch(() => null) : null;
    downloadBlob(blob || samplePdf(d, exp, st), blob ? d.name : d.name.replace(/\.[^.]+$/, '') + '.pdf');
  },
  constancia(btn){
    const exp = byId('expedientes', btn.dataset.id); const u = me(); if(!exp || !u || !exp.releaseFolio) return;
    if(u.role === 'student' && studentOfExp(exp)?.userId !== u.id) return;
    downloadBlob(constanciaPdf(exp), `constancia_${exp.releaseFolio}.pdf`);
  },
  drop(btn){
    const e = byId('expedientes', btn.dataset.id); if(!e || !can('admin','supervisor')) return;
    if(!confirm(`¿Dar de baja el expediente de ${studentNameOfExp(e)}?`)) return;
    e.status = 'baja'; e.updated = nowISO(); logEvent('estado_expediente', `Expediente de ${studentNameOfExp(e)} dado de baja manualmente`, e.id);
    notify(userOfExp(e)?.id, `baja-${e.id}-${e.updated}`, 'Tu expediente fue dado de baja. Comunícate con la oficina de Servicio Social.', 'inicio');
    save(); toast('Expediente dado de baja.'); render();
  },
  reactivate(btn){
    const e = byId('expedientes', btn.dataset.id); if(!e || !can('admin','supervisor')) return;
    e.status = 'pre_registro'; e.updated = nowISO(); logEvent('estado_expediente', `Expediente de ${studentNameOfExp(e)} reactivado manualmente`, e.id);
    runEngine(true); save(); toast('Expediente reactivado; el sistema recalculó su estado.'); render();
  },
  forceRelease(btn){
    const e = byId('expedientes', btn.dataset.id); if(!e || !can('admin')) return;
    if(!confirm(`¿Liberar manualmente a ${studentNameOfExp(e)} aunque no cumpla todos los requisitos?`)) return;
    e.status = 'liberado'; e.releaseFolio = releaseSeq(); e.releasedAt = nowISO(); e.start = e.start || today(); e.updated = nowISO();
    logEvent('estado_expediente', `${studentNameOfExp(e)} liberado manualmente por Administración. Constancia ${e.releaseFolio}`, e.id);
    notify(userOfExp(e)?.id, `lib-${e.id}`, `Tu servicio social quedó liberado. Constancia ${e.releaseFolio}.`, 'inicio');
    save(); toast('Liberado manualmente.'); render();
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
  const btn = form.querySelector('button:not([type=button])'); if(btn){ btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Revisando…'; }
  try{ await actions[form.dataset.action](new FormData(form), form); }
  catch(e){ console.error(e); toast('Algo falló al guardar. Recarga la página e intenta de nuevo.', 'error'); }
  finally{ if(btn && document.body.contains(btn)){ btn.disabled = false; btn.textContent = btn.dataset.label; } }
});
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-click]'); if(!el) return;
  ev.preventDefault(); clicks[el.dataset.click](el);
});
window.addEventListener('hashchange', () => { render(); window.scrollTo(0,0); });
window.addEventListener('storage', e => { if(e.key === DB_KEY){ loadDb().then(render); } });

loadDb().then(() => { runEngine(); render(); });
})();
