const SUPABASE_URL = 'https://krsijkhyewrdyrhrjtva.supabase.co';
const SUPABASE_KEY = 'sb_publishable_VJxmkx41yElltIHnr4YgPw_kXgQ8IZw';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const PAGE = 50;
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const eur = (v) => v === null || v === undefined ? '' : Number(v).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v, d = 4) => v === null || v === undefined ? '' : Number(v).toLocaleString('it-IT', { maximumFractionDigits: d });
const pct = (v) => v === null || v === undefined ? '' : (Number(v) * 100).toLocaleString('it-IT', { maximumFractionDigits: 3 }) + ' %';
const dt = (v) => v ? new Date(v).toLocaleDateString('it-IT') : '';

let page = 0, total = 0, timer = null, seq = 0;

/* ---------- accesso ---------- */
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginErr').textContent = ''; $('loginBtn').disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
  $('loginBtn').disabled = false;
  if (error) { $('loginErr').textContent = 'Email o password non corretti.'; return; }
  $('password').value = '';
  start();
});
$('logoutBtn').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { $('loginForm').classList.remove('hidden'); $('userBox').classList.add('hidden'); $('intro').classList.remove('hidden'); $('app').classList.add('hidden'); return; }
  $('loginForm').classList.add('hidden'); $('userBox').classList.remove('hidden'); $('intro').classList.add('hidden'); $('app').classList.remove('hidden');
  $('whoEmail').textContent = session.user.email;
  const { data: prof } = await sb.from('profili').select('ruolo').eq('user_id', session.user.id).maybeSingle();
  isAdmin = prof?.ruolo === 'admin';
  $('newArt').classList.toggle('hidden', !isAdmin);
  $('whoRole').textContent = isAdmin ? 'Admin' : 'Sola lettura';
  await loadLists();
  await load();
}

const COLS = [
  { k: 'codice', label: 'Codice', w: 150, filter: 'text', g: 'i' },
  { k: 'descrizione', label: 'Descrizione', w: 380, filter: 'text', g: 'i' },
  { k: 'famiglia', label: 'Famiglia', w: 130, filter: 'fam', g: 'i' },
  { k: 'serie', label: 'Serie', w: 320, nosort: true, filter: 'serie', g: 'i' },
  { k: 'fornitore', label: 'Fornitore', w: 160, filter: 'forn', g: 'i' },
  { k: 'codice_articolo_fornitore', label: 'Cod. art. fornitore', w: 160, filter: 'text', g: 'i' },
  { k: 'unita_misura', label: 'U.M.', w: 80, filter: 'um', g: 'i' },
  { k: 'lotto_economico', label: 'Lotto economico', w: 120, num: true, g: 'i' },
  { k: 'lotto_minimo_vendita', label: 'Lotto minimo', w: 110, num: true, g: 'i' },
  { k: 'unita_per_confezione', label: 'Confezione', w: 110, num: true, g: 'i' },
  { k: 'prezzo_acquisto', label: 'Acquisto (€)', w: 120, num: true, g: 'a' },
  { k: 'sconto_unico', label: 'Sconto', w: 100, num: true, g: 'a' },
  { k: 'prezzo_vendita', label: 'Vendita (€)', w: 120, num: true, g: 'v' }
];
const UM = ['pz', 'mt', 'cp', 'cf', 'br'];
const colF = {};              // filtri di colonna
let sort = { k: 'codice', asc: true };
let widths = COLS.map(c => c.w);
try { const w = JSON.parse(localStorage.getItem('listini_w5') || 'null'); if (Array.isArray(w) && w.length === COLS.length) widths = w.map((x, i) => Number(x) > 40 ? Number(x) : COLS[i].w); } catch (e) {}
let fornitori = [], famiglie = [], isAdmin = false, serieAll = [];
const serieSel = new Set();
const serieById = (id) => serieAll.find(x => x.id === id);
const tag = (x, extra = '') => `<span class="tag ${extra}" style="background:${esc(x.colore || '#ccc')}" ${extra ? `data-sid="${x.id}"` : ''}>${esc(x.nome)}</span>`;

function applyWidths() {
  $('cols').innerHTML = widths.map(w => `<col style="width:${w}px">`).join('');
  $('tbl').style.width = widths.reduce((a, b) => a + b, 0) + 'px';
}
function saveWidths() { try { localStorage.setItem('listini_w5', JSON.stringify(widths)); } catch (e) {} }

function setHeadH() { const r = $('thead').rows[0]; if (r) $('tbl').style.setProperty('--h1', r.offsetHeight + 'px'); }
window.addEventListener('resize', setHeadH);
function buildHead() {
  const arrow = (c) => sort.k === c.k ? `<span class="arrow">${sort.asc ? '▲' : '▼'}</span>` : '';
  const h1 = COLS.map((c, i) => `<th class="${c.nosort ? '' : 'sortable '}${c.num ? 'num ' : ''}g-${c.g}" data-i="${i}"><span class="lbl">${esc(c.label)}</span>${c.nosort ? '' : arrow(c)}<span class="rs" data-i="${i}"></span></th>`).join('');
  const h2 = COLS.map(c => {
    const k = ` class="g-${c.g}"`;
    if (c.filter === 'text') return `<th${k}><input type="search" data-f="${c.k}" value="${esc(colF[c.k] || '')}" placeholder="filtra…"></th>`;
    if (c.filter === 'serie') return `<th${k}><button class="btn" id="serieToggle" type="button">${serieLabel()}</button></th>`;
    if (c.filter === 'fam') return `<th${k}><select data-f="${c.k}"><option value="">Tutte</option>${famiglie.map(n => `<option value="${esc(n)}" ${colF[c.k] === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></th>`;
    if (c.filter === 'forn') return `<th${k}><select data-f="${c.k}"><option value="">Tutti</option>${fornitori.map(n => `<option value="${esc(n)}" ${colF[c.k] === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></th>`;
    if (c.filter === 'um') return `<th${k}><select data-f="${c.k}"><option value="">Tutte</option>${UM.map(n => `<option value="${n}" ${colF[c.k] === n ? 'selected' : ''}>${n}</option>`).join('')}</select></th>`;
    return `<th${k}></th>`;
  }).join('');
  $('thead').innerHTML = `<tr>${h1}</tr><tr class="frow">${h2}</tr>`;
  setHeadH();
}

$('thead').addEventListener('mousedown', (e) => {
  const rs = e.target.closest('.rs'); if (!rs) return;
  e.preventDefault(); e.stopPropagation();
  const i = Number(rs.dataset.i), x0 = e.clientX, w0 = widths[i]; rs.classList.add('on');
  const move = (ev) => { widths[i] = Math.max(50, w0 + ev.clientX - x0); applyWidths(); };
  const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); rs.classList.remove('on'); saveWidths(); };
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
});
$('thead').addEventListener('click', (e) => {
  if (e.target.closest('.rs')) return;
  const th = e.target.closest('th.sortable'); if (!th) return;
  const c = COLS[Number(th.dataset.i)];
  sort = sort.k === c.k ? { k: c.k, asc: !sort.asc } : { k: c.k, asc: true };
  buildHead(); page = 0; load();
});
$('thead').addEventListener('input', (e) => {
  const f = e.target.dataset.f; if (!f) return;
  colF[f] = e.target.value;
  clearTimeout(timer); timer = setTimeout(refilter, 300);
});
$('thead').addEventListener('change', (e) => {
  if (e.target.tagName !== 'SELECT') return;
  colF[e.target.dataset.f] = e.target.value; refilter();
});

async function loadLists() {
  const [forn, fam] = await Promise.all([sb.from('fornitori').select('nome').order('nome'), sb.from('famiglie').select('nome').order('nome')]);
  fornitori = (forn.data || []).map(r => r.nome);
  famiglie = (fam.data || []).map(r => r.nome);
  const se = await sb.from('sistemi').select('id,nome,colore').eq('gruppo', 'sottofamiglia').order('nome');
  serieAll = se.data || [];
  renderSerieBar();
  buildHead();
}

/* ---------- filtro serie ---------- */
function serieLabel() { return (serieSel.size ? (serieSel.size === 1 ? '1 selezionata' : `${serieSel.size} selezionate`) : 'Tutte le serie') + ' ▾'; }
function renderSerieBar() {
  $('seriePanel').innerHTML = `<div class="ph"><span>Clicca per scegliere una o più serie</span><span>${serieSel.size ? '<button class="link" id="serieClear" type="button">Azzera serie</button>' : ''}<button class="link" id="serieClose" type="button">Chiudi ✕</button></span></div><div class="tags">` +
    serieAll.map(x => tag(x, 'pick' + (serieSel.has(x.id) ? ' sel' : ''))).join('') + '</div>';
  const b = $('serieToggle'); if (b) b.textContent = serieLabel();
}
function closeSerie() { $('seriePanel').classList.add('hidden'); }
function openSerie() {
  const b = $('serieToggle'); if (!b) return;
  renderSerieBar();
  const r = b.getBoundingClientRect(), pn = $('seriePanel');
  pn.classList.remove('hidden');
  pn.style.top = (r.bottom + 4) + 'px';
  pn.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pn.offsetWidth - 8)) + 'px';
}
document.addEventListener('click', (e) => {
  if (e.target.closest('#serieToggle')) { $('seriePanel').classList.contains('hidden') ? openSerie() : closeSerie(); return; }
  if (e.target.closest('#serieClear')) { serieSel.clear(); renderSerieBar(); page = 0; load(); return; }
  if (e.target.closest('#serieClose')) { closeSerie(); return; }
  if (!e.target.closest('#seriePanel')) closeSerie();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSerie(); });
document.querySelector('.tablewrap').addEventListener('scroll', closeSerie);
function onPick(e) {
  const t = e.target.closest('.tag.pick'); if (!t) return;
  e.stopPropagation();
  const id = Number(t.dataset.sid); serieSel.has(id) ? serieSel.delete(id) : serieSel.add(id);
  renderSerieBar(); page = 0; load();
}
$('seriePanel').addEventListener('click', onPick);

/* ---------- elenco ---------- */
async function load() {
  const my = ++seq;
  let q = sb.from('v_articoli_lista')
    
    .select('id,serie_ids,codice,descrizione,famiglia,fornitore,codice_articolo_fornitore,unita_misura,lotto_economico,lotto_minimo_vendita,unita_per_confezione,prezzo_acquisto,sconto_unico,prezzo_vendita,obsoleto', { count: 'exact' })
    .order(sort.k, { ascending: sort.asc, nullsFirst: false });
  if (sort.k !== 'codice') q = q.order('codice');
  const text = $('q').value.trim().replace(/[,()%*\\]/g, ' ');
  if (text) q = q.or(`codice.ilike.%${text}%,descrizione.ilike.%${text}%,codice_articolo_fornitore.ilike.%${text}%`);
  ['codice', 'descrizione', 'codice_articolo_fornitore'].forEach(k => { const v = (colF[k] || '').trim().replace(/[%*]/g, ''); if (v) q = q.ilike(k, `%${v}%`); });
  if (colF.fornitore) q = q.eq('fornitore', colF.fornitore);
  if (colF.famiglia) q = q.eq('famiglia', colF.famiglia);
  if (serieSel.size) q = q.overlaps('serie_ids', [...serieSel]);
  if (colF.unita_misura) q = q.eq('unita_misura', colF.unita_misura);
  if (!$('cObs').checked) q = q.eq('obsoleto', false);
  if ($('cNoPrice').checked) q = q.is('prezzo_acquisto', null);
  q = q.range(page * PAGE, page * PAGE + PAGE - 1);
  const { data, count, error } = await q;
  if (my !== seq) return;
  if (error) { $('rows').innerHTML = ''; $('empty').textContent = 'Errore nel caricamento: ' + error.message; $('empty').classList.remove('hidden'); return; }
  total = count || 0;
  listIds = (data || []).map(r => r.id);
  $('empty').textContent = 'Nessun articolo trovato.';
  $('empty').classList.toggle('hidden', total > 0);
  const cell = (c, r) => {
    if (c.k === 'codice') return esc(r.codice) + (r.obsoleto ? '<span class="badge">obsoleto</span>' : '');
    if (c.k === 'prezzo_acquisto' || c.k === 'prezzo_vendita') return eur(r[c.k]);
    if (c.k === 'sconto_unico') return Number(r.sconto_unico) > 0 ? pct(r.sconto_unico) : '';
    if (['lotto_economico', 'lotto_minimo_vendita', 'unita_per_confezione'].includes(c.k)) return num(r[c.k], 3);
    if (c.k === 'serie') return (r.serie_ids || []).map(serieById).filter(Boolean).map(x => tag(x)).join('');
    return esc(r[c.k]);
  };
  $('rows').innerHTML = (data || []).map(r => `<tr data-id="${r.id}" class="${r.obsoleto ? 'obs' : ''}">` +
    COLS.map(c => `<td class="${c.num ? 'num ' : ''}g-${c.g}" ${c.k === 'descrizione' ? `title="${esc(r.descrizione)}"` : c.k === 'serie' ? `title="${esc((r.serie_ids || []).map(serieById).filter(Boolean).map(x => x.nome).join(', '))}"` : ''}>${cell(c, r)}</td>`).join('') + '</tr>').join('');
  const from = total ? page * PAGE + 1 : 0, to = Math.min(total, (page + 1) * PAGE);
  const label = `${from}–${to} di ${total.toLocaleString('it-IT')} articoli`;
  $('count').textContent = label; $('count2').textContent = label;
  ['prev', 'prev2'].forEach(id => $(id).disabled = page === 0);
  ['next', 'next2'].forEach(id => $(id).disabled = to >= total);
}

function refilter() { page = 0; load(); }
$('q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refilter, 300); });
['cObs', 'cNoPrice'].forEach(id => $(id).addEventListener('change', refilter));
$('reset').addEventListener('click', () => {
  $('q').value = ''; $('cObs').checked = false; $('cNoPrice').checked = false;
  Object.keys(colF).forEach(k => delete colF[k]); serieSel.clear(); renderSerieBar(); sort = { k: 'codice', asc: true }; buildHead(); refilter();
});
['prev', 'prev2'].forEach(id => $(id).addEventListener('click', () => { if (page > 0) { page--; load(); window.scrollTo(0, 0); } }));
['next', 'next2'].forEach(id => $(id).addEventListener('click', () => { page++; load(); window.scrollTo(0, 0); }));
$('rows').addEventListener('click', (e) => { const tr = e.target.closest('tr'); if (tr) openArticle(tr.dataset.id); });
applyWidths();

/* ---------- scheda articolo ---------- */
function dl(pairs) {
  const rows = pairs.filter(([, v, force]) => force || (v !== '' && v !== null && v !== undefined));
  return rows.length ? '<dl>' + rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v === '' || v === null || v === undefined ? '—' : esc(v)}</dd>`).join('') + '</dl>' : '<span class="who">—</span>';
}

let currentId = null, currentSist = [];

let curImg = null;
const BUCKET = 'immagini-articoli';
let listIds = [], curArt = null, curHist = [], editing = null, lookups = null;
const pctIn = (v) => v === null || v === undefined ? '' : String(+(Number(v) * 100).toFixed(4)).replace('.', ',');
const numIn = (v) => v === null || v === undefined ? '' : String(Number(v)).replace('.', ',');
const OR_LABEL = { listino_fornitore: 'Listino fornitore', netto_dedicato: 'Netto dedicato', manuale: 'Manuale' };

async function ensureLookups() {
  if (lookups) return;
  const [f, th, fo, vf, vm] = await Promise.all([
    sb.from('famiglie').select('id,nome').order('nome'), sb.from('tipi_hardware').select('id,nome').order('nome'),
    sb.from('fornitori').select('id,nome,codice').order('nome'), sb.from('v_finiture_valori').select('valore'), sb.from('v_materiali_valori').select('valore')]);
  lookups = { famiglie: f.data || [], tipi: th.data || [], fornitori: fo.data || [], fin: (vf.data || []).map(x => x.valore), mat: (vm.data || []).map(x => x.valore) };
}
const fIn = (label, k, t, v, cls = '') => `<label class="f ${cls}"><span>${esc(label)}</span><input type="text" data-k="${k}" data-t="${t}" value="${esc(v ?? '')}"></label>`;
const fSel = (label, k, opts, v, cls = '') => `<label class="f ${cls}"><span>${esc(label)}</span><select data-k="${k}" data-t="${opts.num ? 'id' : 'text'}"><option value=""></option>${opts.list.map(o => `<option value="${esc(o[0])}" ${String(o[0]) === String(v ?? '') ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></label>`;
const NEWLBL = { colore: ['+ nuova finitura', 'Nome della nuova finitura'], materiale_base: ['+ nuovo materiale', 'Nome del nuovo materiale'] };
const fCombo = (label, k, list, v, cls = '') => {
  const vals = [...new Set([...list, ...(v ? [v] : [])])].sort((a, b) => a.localeCompare(b, 'it'));
  return `<label class="f ${cls}"><span>${esc(label)} <button type="button" class="link" data-newval="${k}">${NEWLBL[k][0]}</button></span><select data-k="${k}" data-t="text" data-combo="1"><option value=""></option>${vals.map(x => `<option value="${esc(x)}" ${x === (v ?? '') ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>`;
};
const fSup = (v) => `<label class="f"><span>Fornitore <button type="button" class="link" data-newsup="1">+ nuovo fornitore</button></span><select data-k="fornitore_id" data-t="id"><option value=""></option>${lookups.fornitori.map(o => `<option value="${o.id}" ${String(o.id) === String(v ?? '') ? 'selected' : ''}>${esc(o.nome)}</option>`).join('')}</select></label>`;
const idOpts = (arr) => ({ num: true, list: arr.map(x => [x.id, x.nome]) });

function viewIdent(a) {
  return `<div class="identgrid"><div>
    <div class="identcols"><div>${dl([
      ['Codice padre', a.codice_padre], ['Famiglia', a.famiglia], ['Finitura', a.colore], ['Materiale base', a.materiale_base],
      ['Fornitore', a.fornitore], ['Codice fornitore', a.codice_fornitore], ['Codice articolo fornitore', a.codice_articolo_fornitore, true]])}</div>
    <div>${dl([
      ['Unità di misura', a.unita_misura], ['Lotto economico', num(a.lotto_economico)], ['Lotto minimo di vendita', num(a.lotto_minimo_vendita)],
      ['Unità per confezione', num(a.unita_per_confezione)], ['Lunghezza barra', num(a.lunghezza_barra)], ['Note', a.note]])}</div></div>
    <div class="sec" id="compat"></div>
  </div><div class="imgcol"><div class="imgbox" id="imgbox">Immagine articolo<br>(non ancora caricata)</div>${isAdmin ? `<div class="imgact"><button class="btn" data-img="pick">${curImg ? 'Cambia immagine' : 'Inserisci immagine'}</button>${curImg ? '<button class="btn" data-img="del">Rimuovi</button>' : ''}<input type="file" id="imgFile" accept="image/*" class="hidden"></div><span class="err" id="imgErr" style="margin:0;min-height:0"></span>` : ''}</div></div>`;
}
function editIdent(a) {
  const um = [...new Set([...UM, a.unita_misura].filter(Boolean))].map(x => [x, x]);
  return `<div class="formgrid">
    ${fIn('Descrizione', 'descrizione', 'text', a.descrizione, 'wide')}
    ${fIn('Codice padre', 'codice_padre', 'text', a.codice_padre)}
    ${fSel('Famiglia', 'famiglia_id', idOpts(lookups.famiglie), a.famiglia_id)}
    ${fCombo('Finitura', 'colore', lookups.fin, a.colore)}
    ${fSel('Hardware type', 'tipo_hardware_id', idOpts(lookups.tipi), a.tipo_hardware_id)}
    ${fCombo('Materiale base', 'materiale_base', lookups.mat, a.materiale_base)}
    ${fSup(a.fornitore_id)}
    ${fIn('Codice fornitore', 'codice_fornitore', 'text', a.codice_fornitore)}
    ${fIn('Codice articolo fornitore', 'codice_articolo_fornitore', 'text', a.codice_articolo_fornitore)}
    ${fSel('Unità di misura', 'unita_misura', { list: um }, a.unita_misura)}
    ${fIn('Lotto economico', 'lotto_economico', 'num', numIn(a.lotto_economico))}
    ${fIn('Lotto minimo di vendita', 'lotto_minimo_vendita', 'num', numIn(a.lotto_minimo_vendita))}
    ${fIn('Unità per confezione', 'unita_per_confezione', 'num', numIn(a.unita_per_confezione))}
    ${fIn('Lunghezza barra', 'lunghezza_barra', 'num', numIn(a.lunghezza_barra))}
    ${fIn('Note', 'note', 'text', a.note, 'wide')}
    <label class="f ck"><input type="checkbox" data-k="obsoleto" data-t="bool" ${a.obsoleto ? 'checked' : ''}><span>Articolo obsoleto</span></label>
  </div>${actions('ident')}<div class="sec" id="compat"></div>`;
}
function storico(campo) {
  const r = curHist.filter(x => campo === 'acq' ? x.campo === 'prezzo_acquisto' : x.campo !== 'prezzo_acquisto');
  return `<div class="mini">Storico prezzi</div>` + (r.length ? `<table class="hist"><thead><tr><th>Data</th><th class="num">Prima</th><th class="num">Dopo</th></tr></thead><tbody>${
    r.map(x => `<tr><td>${dt(x.data_modifica)}</td><td class="num">${eur(x.valore_precedente)}</td><td class="num">${eur(x.valore_nuovo)}</td></tr>`).join('')
  }</tbody></table>` : '<span class="who">Nessuna variazione registrata.</span>');
}
function viewAcq(a) {
  return `<div class="big">${a.prezzo_acquisto === null ? 'prezzo non presente' : eur(a.prezzo_acquisto) + ' €'}</div>${dl([
    ['Origine del prezzo', OR_LABEL[a.origine_prezzo] || ''],
    ['Sconti a cascata', [a.sconto_base, a.sconto_extra1, a.sconto_extra2, a.sconto_extra3].filter(x => Number(x) > 0).map(pct).join(' + ')],
    ['Sconto unico', Number(a.sconto_unico) > 0 ? pct(a.sconto_unico) : ''],
    ['Variazione prezzo', Number(a.variazione_prezzo) !== 0 ? pct(a.variazione_prezzo) : ''],
    ['Ultima variazione', dt(a.data_ultima_variazione)]])}${storico('acq')}`;
}
function editAcq(a) {
  return `<div class="formgrid">
    ${fIn('Prezzo di acquisto (€)', 'prezzo_acquisto', 'num', numIn(a.prezzo_acquisto))}
    ${fSel('Origine del prezzo', 'origine_prezzo', { list: Object.entries(OR_LABEL) }, a.origine_prezzo)}
    ${fIn('Variazione prezzo (%)', 'variazione_prezzo', 'pct0', pctIn(a.variazione_prezzo))}
    ${fIn('Sconto base (%)', 'sconto_base', 'pct0', pctIn(a.sconto_base))}
    ${fIn('Sconto extra 1 (%)', 'sconto_extra1', 'pct0', pctIn(a.sconto_extra1))}
    ${fIn('Sconto extra 2 (%)', 'sconto_extra2', 'pct0', pctIn(a.sconto_extra2))}
    ${fIn('Sconto extra 3 (%)', 'sconto_extra3', 'pct0', pctIn(a.sconto_extra3))}
  </div><div class="hint">Se cambi il prezzo di acquisto o gli sconti, il prezzo di vendita viene ricalcolato e sale solo se il nuovo calcolo è più alto.</div>${actions('acq')}`;
}
function viewVen(a) {
  const pers = a.ricarico_personalizzato !== null && a.ricarico_personalizzato !== undefined;
  const ricEff = a.coefficiente_effettivo == null ? '' : pct(Number(a.coefficiente_effettivo) - 1);
  return `<div class="big">${a.prezzo_vendita === null ? 'prezzo non presente' : eur(a.prezzo_vendita) + ' €'}</div>${dl([
    ['Calcolo standard', a.prezzo_calcolato == null ? '' : eur(a.prezzo_calcolato) + ' €'], ['Ricarico effettivo', ricEff],
    ['Ricarico personalizzato', pers ? pct(a.ricarico_personalizzato) : ''],
    ['Attrezzatura', a.attrezzatura], ['Ammortamento', a.ammortamento == null ? '' : eur(a.ammortamento) + ' €'],
    ['Ricarico su ammortamento', Number(a.ricarico_ammortamento) > 0 ? pct(a.ricarico_ammortamento) : '']])}${storico('ven')}`;
}
function editVen(a) {
  return `<div class="formgrid">
    ${fIn('Prezzo di vendita (€)', 'prezzo_vendita', 'num', numIn(a.prezzo_vendita))}
    ${fIn('Ricarico personalizzato (%) – vuoto = standard', 'ricarico_personalizzato', 'pct', pctIn(a.ricarico_personalizzato))}
    ${fIn('Attrezzatura', 'attrezzatura', 'text', a.attrezzatura)}
    ${fIn('Ammortamento (€)', 'ammortamento', 'num', numIn(a.ammortamento))}
    ${fIn('Ricarico su ammortamento (%)', 'ricarico_ammortamento', 'pct0', pctIn(a.ricarico_ammortamento))}
  </div><div class="hint">Calcolo standard attuale: ${a.prezzo_calcolato == null ? '—' : eur(a.prezzo_calcolato) + ' €'}. Se imposti a mano il prezzo di vendita, viene salvato così com'è (anche se più basso).
  Se modifichi solo ricarico o ammortamento, il prezzo sale automaticamente solo se il nuovo calcolo è più alto.</div>${actions('ven')}`;
}
const actions = (sec) => `<div class="formact"><button class="btn primary" data-save="${sec}">Salva</button><button class="btn" data-cancel="1">Annulla</button><span class="err" id="saveErr" style="margin:0;min-height:0"></span></div>`;

function renderModal() {
  const a = curArt;
  const idx = listIds.indexOf(currentId);
  const pos = idx >= 0 ? `${page * PAGE + idx + 1} / ${total}` : '';
  const eb = (sec) => isAdmin && editing !== sec ? `<button class="hbtn" data-edit="${sec}">Modifica</button>` : '';
  const view = { ident: viewIdent, acq: viewAcq, ven: viewVen }, edit = { ident: editIdent, acq: editAcq, ven: editVen };
  const body = (sec) => editing === sec ? edit[sec](a) : view[sec](a);
  $('drawerBody').innerHTML = `
    <div class="mhead">
      <div class="tt"><h2>${esc(a.codice)}${a.obsoleto ? '<span class="badge">obsoleto</span>' : ''}</h2><div class="sub">${esc(a.descrizione)}</div></div>
      <div class="mnav"><span class="pos">${pos}</span>${isAdmin ? '<button class="btn" data-dup="1" title="Crea un nuovo articolo partendo da questo" style="font-size:13px">Duplica</button>' : ''}
        <button class="btn" data-nav="-1" title="Articolo precedente (←)">←</button>
        <button class="btn" data-nav="1" title="Articolo successivo (→)">→</button>
        <button class="btn" id="closeDrawer" title="Chiudi (Esc)">✕</button></div>
    </div>
    <div class="mbody">
      <div class="box ident" data-sec="ident"><h3><span>Identificazione</span>${eb('ident')}</h3><div class="in">${body('ident')}</div></div>
      <div class="two">
        <div class="box acq" data-sec="acq"><h3><span>Acquisto</span>${eb('acq')}</h3><div class="in">${body('acq')}</div></div>
        <div class="box ven" data-sec="ven"><h3><span>Vendita</span>${eb('ven')}</h3><div class="in">${body('ven')}</div></div>
      </div>
    </div>`;
  renderCompat();
  loadImage();
}

async function loadImage() {
  const box = $('imgbox'); if (!box || !curImg) return;
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(curImg, 3600);
  const b2 = $('imgbox'); if (!b2 || !data?.signedUrl) return;
  b2.classList.add('has'); b2.innerHTML = `<img alt="Immagine articolo" src="${data.signedUrl}">`;
}

async function resizeImage(file, max = 900) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
}
async function uploadImage(file) {
  const err = (m) => { const e = $('imgErr'); if (e) e.textContent = m; };
  try {
    err('Caricamento…');
    const blob = await resizeImage(file);
    const path = `${currentId}.jpg`;
    const up = await sb.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
    if (up.error) return err('Errore: ' + up.error.message);
    const u = await sb.from('articoli').update({ immagine: path }).eq('id', currentId);
    if (u.error) return err('Errore: ' + u.error.message);
    await openArticle(currentId, true);
  } catch (e) { err('Immagine non valida o non leggibile.'); }
}
async function removeImage() {
  if (!curImg) return;
  await sb.storage.from(BUCKET).remove([curImg]);
  await sb.from('articoli').update({ immagine: null }).eq('id', currentId);
  await openArticle(currentId, true);
}

async function openArticle(id, keepEdit = false) {
  currentId = Number(id);
  if (!keepEdit) editing = null;
  $('veil').classList.remove('hidden'); $('drawer').classList.remove('hidden');
  if (!$('drawerBody').firstChild) $('drawerBody').innerHTML = '<p class="who" style="padding:20px">Caricamento…</p>';
  const [art, hist, sist, img] = await Promise.all([
    sb.from('v_articoli').select('*').eq('id', id).single(),
    sb.from('storico_prezzi').select('data_modifica,campo,valore_precedente,valore_nuovo').eq('articolo_id', id).order('data_modifica', { ascending: false }).limit(100),
    sb.from('articoli_sistemi').select('sistema_id, sistemi(id,nome,gruppo)').eq('articolo_id', id),
    sb.from('articoli').select('immagine').eq('id', id).single()
  ]);
  if (Number(id) !== currentId) return;
  curImg = img.data?.immagine || null;
  if (art.error) { $('drawerBody').innerHTML = '<p class="err" style="padding:20px">Errore: ' + esc(art.error.message) + '</p>'; return; }
  curArt = art.data; curHist = hist.data || [];
  currentSist = (sist.data || []).map(x => x.sistemi).filter(Boolean);
  renderModal();
}

async function startEdit(sec) {
  if (!isAdmin) return;
  if (sec === 'ident' || sec === 'acq') await ensureLookups();
  editing = sec; renderModal();
}

async function saveSection(sec) {
  const box = document.querySelector(`.box[data-sec="${sec}"]`), a = curArt, payload = {};
  const err = (m) => { $('saveErr').textContent = m; };
  let bad = null;
  box.querySelectorAll('[data-k]').forEach(el => {
    if (bad) return;
    const k = el.dataset.k, t = el.dataset.t; let v;
    if (t === 'bool') v = el.checked;
    else {
      let rv = el.value;
      if (el.dataset.combo && rv === '__new__') rv = box.querySelector(`[data-newfor="${k}"]`)?.value || '';
      const raw = rv.trim();
      if (raw === '') v = t === 'pct0' ? 0 : null;
      else if (t === 'text') v = raw;
      else if (t === 'id') v = Number(raw);
      else {
        const n = Number(raw.replace(',', '.'));
        if (!isFinite(n)) { bad = 'Valore non valido: ' + (el.closest('label')?.querySelector('span')?.textContent || k); return; }
        v = (t === 'pct' || t === 'pct0') ? Math.round(n * 1e4) / 1e6 : n;
      }
    }
    const old = a[k];
    const same = v === null ? (old === null || old === undefined || old === '') : t === 'text' ? String(old ?? '') === v : t === 'bool' ? !!old === v : Number(old) === v;
    if (!same) payload[k] = v;
  });
  if (bad) return err(bad);
  if (sec === 'ident' && 'descrizione' in payload && !payload.descrizione) return err('La descrizione non può essere vuota.');
  if (!Object.keys(payload).length) { editing = null; renderModal(); return; }
  if ('prezzo_acquisto' in payload) payload.data_ultima_variazione = new Date().toISOString().slice(0, 10);
  box.querySelectorAll('.btn').forEach(b => b.disabled = true);
  const up = await sb.from('articoli').update(payload).eq('id', currentId);
  if (up.error) { box.querySelectorAll('.btn').forEach(b => b.disabled = false); return err('Errore: ' + up.error.message); }
  const toCalc = sec === 'acq' || (sec === 'ven' && !('prezzo_vendita' in payload));
  if (toCalc) await sb.rpc('aggiorna_prezzo_vendita', { p_articolo: currentId });
  editing = null;
  await openArticle(currentId); load();
}

async function navArticle(dir) {
  const idx = listIds.indexOf(currentId);
  if (idx < 0) return;
  const j = idx + dir;
  if (j >= 0 && j < listIds.length) return openArticle(listIds[j]);
  const np = page + dir;
  if (np < 0 || np * PAGE >= total) return;
  page = np; await load();
  if (listIds.length) openArticle(dir > 0 ? listIds[0] : listIds[listIds.length - 1]);
}

/* ---------- serie (etichette colorate) ---------- */
function renderCompat() {
  const mine = currentSist.filter(x => x.gruppo === 'sottofamiglia').map(x => serieById(x.id) || x);
  $('compat').innerHTML = `<h3>Serie${isAdmin ? '<button class="link" data-act="edit-compat">Modifica</button>' : ''}</h3>
    <div>${mine.map(x => tag(x)).join('') || '<span class="who">—</span>'}</div>`;
}

function editCompat() {
  const have = new Set(currentSist.map(x => x.id));
  $('compat').innerHTML = `<h3>Modifica serie</h3><div class="editbox">
    <div id="pickBox">${serieAll.map(x => tag(x, 'pick' + (have.has(x.id) ? ' sel' : ''))).join('')}</div>
    <h4>Aggiungi una nuova serie (non ancora in elenco)</h4>
    <div class="row"><input type="text" id="newSist" placeholder="es. Eku Nuova Linea"><input type="color" id="newColor" value="#dbe8f5" title="Colore"></div>
    <div class="row"><button class="btn" data-act="save-compat">Salva</button><button class="btn" data-act="cancel-compat">Annulla</button><span class="err" id="compatErr"></span></div></div>`;
  $('pickBox').addEventListener('click', (e) => { const t = e.target.closest('.tag.pick'); if (t) t.classList.toggle('sel'); });
}

async function saveCompat() {
  const btns = document.querySelectorAll('#compat .btn'); btns.forEach(b => b.disabled = true);
  const err = (m) => { $('compatErr').textContent = m; btns.forEach(b => b.disabled = false); };
  const have = new Set(currentSist.filter(x => x.gruppo === 'sottofamiglia').map(x => x.id));
  const want = new Set([...document.querySelectorAll('#pickBox .tag.sel')].map(i => Number(i.dataset.sid)));
  const nuovo = $('newSist').value.trim().replace(/\s+/g, ' ');
  if (nuovo) {
    const esiste = serieAll.find(x => x.nome.toLowerCase() === nuovo.toLowerCase());
    if (esiste) want.add(esiste.id);
    else {
      const ins = await sb.from('sistemi').insert({ nome: nuovo, gruppo: 'sottofamiglia', colore: $('newColor').value.toUpperCase() }).select('id,nome,colore').single();
      if (ins.error) return err('Errore: ' + ins.error.message);
      serieAll.push(ins.data); serieAll.sort((a, b) => a.nome.localeCompare(b.nome)); want.add(ins.data.id); renderSerieBar();
    }
  }
  const toDel = [...have].filter(x => !want.has(x)), toAdd = [...want].filter(x => !have.has(x));
  if (toDel.length) { const d = await sb.from('articoli_sistemi').delete().eq('articolo_id', currentId).in('sistema_id', toDel); if (d.error) return err('Errore: ' + d.error.message); }
  if (toAdd.length) { const i = await sb.from('articoli_sistemi').insert(toAdd.map(sid => ({ articolo_id: Number(currentId), sistema_id: sid }))); if (i.error) return err('Errore: ' + i.error.message); }
  await openArticle(currentId, true); load();
}

$('drawer').addEventListener('click', (e) => {
  const act = e.target.dataset?.act; if (!act) return;
  if (act === 'edit-compat') editCompat();
  if (act === 'save-compat') saveCompat();
  if (act === 'cancel-compat') renderCompat();
});
/* ---------- nuovo articolo guidato ---------- */
let wiz = null;
const STEPS = ['Codice', 'Fornitore', 'Prezzo', 'Lotti e serie', 'Riepilogo'];
async function startWizard(from) {
  if (!isAdmin) return;
  await ensureLookups();
  const pr = await sb.from('parametri').select('valore').eq('chiave', 'ricarico_standard').maybeSingle();
  const d = { origine_prezzo: 'listino_fornitore', unita_misura: 'pz' }, serie = new Set();
  if (from) {
    const a = from, t = (k) => a[k] ?? '';
    Object.assign(d, {
      descrizione: t('descrizione'), codice_padre: '', famiglia_id: t('famiglia_id'), colore: t('colore'), tipo_hardware_id: t('tipo_hardware_id'),
      materiale_base: t('materiale_base'), unita_misura: t('unita_misura') || 'pz', fornitore_id: t('fornitore_id'), codice_fornitore: t('codice_fornitore'),
      codice_articolo_fornitore: '', origine_prezzo: t('origine_prezzo') || 'listino_fornitore', prezzo_acquisto: numIn(a.prezzo_acquisto),
      variazione_prezzo: pctIn(a.variazione_prezzo), sconto_base: pctIn(a.sconto_base), sconto_extra1: pctIn(a.sconto_extra1), sconto_extra2: pctIn(a.sconto_extra2), sconto_extra3: pctIn(a.sconto_extra3),
      ricarico_personalizzato: pctIn(a.ricarico_personalizzato), attrezzatura: t('attrezzatura'), ammortamento: numIn(a.ammortamento), ricarico_ammortamento: pctIn(a.ricarico_ammortamento),
      lotto_economico: numIn(a.lotto_economico), lotto_minimo_vendita: numIn(a.lotto_minimo_vendita), unita_per_confezione: numIn(a.unita_per_confezione), lunghezza_barra: numIn(a.lunghezza_barra), note: t('note')
    });
    currentSist.filter(x => x.gruppo === 'sottofamiglia').forEach(x => serie.add(x.id));
  }
  wiz = { step: 0, d, serie, ric: Number(pr.data?.valore ?? 1.4), from: from ? from.codice : null, err: '' };
  closeSerie(); $('veil').classList.remove('hidden'); $('drawer').classList.remove('hidden');
  renderWizard();
}
const wv = (k) => wiz.d[k] === '__new__' ? '' : (wiz.d[k] ?? '');
const wnum = (k) => { const v = String(wv(k)).trim().replace(',', '.'); return v === '' ? null : Number(v); };
const wpct = (k) => { const n = wnum(k); return n === null ? null : Math.round(n * 1e4) / 1e6; };
function wizCalc() {
  const base = wnum('prezzo_acquisto');
  const sc = 1 - [1, 2, 3, 4].reduce((acc, i) => acc * (1 - (wpct(['sconto_base', 'sconto_extra1', 'sconto_extra2', 'sconto_extra3'][i - 1]) || 0)), 1);
  if (base === null || !isFinite(base)) return { sc, price: null };
  const ric = wpct('ricarico_personalizzato') ?? wiz.ric, amm = wnum('ammortamento') || 0, ramm = wpct('ricarico_ammortamento') || 0, v = wpct('variazione_prezzo') || 0;
  const price = base * (1 + v) === 0 ? null : Math.round((base * (1 + v) * (1 - sc) * (1 + ric) + amm * (1 + ramm)) * 100) / 100;
  return { sc, price, ric };
}
function wizPreviewHtml() {
  const c = wizCalc();
  return `<div class="big">${c.price === null ? 'Inserisci il prezzo di acquisto' : eur(c.price) + ' €'}</div>
    <span class="who" style="color:inherit;opacity:.75">Prezzo di vendita calcolato${c.price === null ? '' : ` · sconto unico ${pct(c.sc)} · ricarico ${pct(c.ric)}`}</span>`;
}
const wi = (label, k, t, cls = '') => fIn(label, k, t, wv(k), cls);
const ws = (label, k, opts, cls = '') => fSel(label, k, opts, wv(k), cls);

function wizBody() {
  const um = ws('Unità di misura', 'unita_misura', { list: UM.map(x => [x, x]) });
  switch (wiz.step) {
    case 0: return `<div class="formgrid">
      ${wi('Codice articolo *', 'codice', 'text')}${ws('Famiglia', 'famiglia_id', idOpts(lookups.famiglie))}${um}
      ${wi('Descrizione *', 'descrizione', 'text', 'wide')}
      ${fCombo('Finitura', 'colore', lookups.fin, wv('colore'))}${ws('Hardware type', 'tipo_hardware_id', idOpts(lookups.tipi))}${fCombo('Materiale base', 'materiale_base', lookups.mat, wv('materiale_base'))}
      ${wi('Codice padre', 'codice_padre', 'text')}
    </div><div class="hint">Codice padre: lascia vuoto se questo articolo è il padre (si imposta da solo uguale al codice). Per una nuova finitura di un articolo esistente, scrivi qui il codice dell'articolo padre.</div>`;
    case 1: return `<div class="formgrid">
      ${fSup(wv('fornitore_id'))}${ws('Origine del prezzo', 'origine_prezzo', { list: Object.entries(OR_LABEL) })}
      ${wi('Codice fornitore', 'codice_fornitore', 'text')}${wi('Codice articolo fornitore', 'codice_articolo_fornitore', 'text')}
    </div>`;
    case 2: return `<div class="formgrid">
      ${wi('Prezzo di acquisto (€) – listino fornitore', 'prezzo_acquisto', 'num')}${wi('Variazione prezzo (%)', 'variazione_prezzo', 'pct0')}<span></span>
      ${wi('Sconto base (%)', 'sconto_base', 'pct0')}${wi('Sconto extra 1 (%)', 'sconto_extra1', 'pct0')}${wi('Sconto extra 2 (%)', 'sconto_extra2', 'pct0')}
      ${wi('Sconto extra 3 (%)', 'sconto_extra3', 'pct0')}
    </div><div class="prev" id="wizPrev">${wizPreviewHtml()}</div>
    <details class="adv" ${wv('ricarico_personalizzato') || wv('ammortamento') || wv('attrezzatura') ? 'open' : ''}><summary>Opzioni di vendita (ricarico personalizzato, ammortamento)</summary><div class="formgrid">
      ${wi('Ricarico personalizzato (%) – vuoto = standard', 'ricarico_personalizzato', 'pct')}${wi('Attrezzatura', 'attrezzatura', 'text')}<span></span>
      ${wi('Ammortamento (€)', 'ammortamento', 'num')}${wi('Ricarico su ammortamento (%)', 'ricarico_ammortamento', 'pct0')}
    </div></details>`;
    case 3: return `<div class="formgrid">
      ${wi('Lotto economico', 'lotto_economico', 'num')}${wi('Lotto minimo di vendita', 'lotto_minimo_vendita', 'num')}${wi('Unità per confezione', 'unita_per_confezione', 'num')}
      ${wi('Lunghezza barra', 'lunghezza_barra', 'num')}${wi('Note', 'note', 'text', 'wide')}
    </div><div class="mini">Serie di appartenenza</div><div class="wizserie">${serieAll.map(x => tag(x, 'pick' + (wiz.serie.has(x.id) ? ' sel' : ''))).join('')}</div>`;
    default: {
      const nm = (arr, id) => arr.find(x => String(x.id) === String(id))?.nome || '';
      const c = wizCalc();
      return `<div class="two"><div>${dl([
        ['Codice', wv('codice'), true], ['Descrizione', wv('descrizione'), true], ['Codice padre', wv('codice_padre') || '(= codice)'], ['Famiglia', nm(lookups.famiglie, wv('famiglia_id'))], ['Finitura', wv('colore')],
        ['Hardware type', nm(lookups.tipi, wv('tipo_hardware_id'))], ['Materiale base', wv('materiale_base')], ['Unità di misura', wv('unita_misura')],
        ['Lotto economico', wv('lotto_economico')], ['Lotto minimo', wv('lotto_minimo_vendita')], ['Confezione', wv('unita_per_confezione')], ['Note', wv('note')]])}
        <div class="mini">Serie</div><div>${[...wiz.serie].map(serieById).filter(Boolean).map(x => tag(x)).join('') || '<span class="who">—</span>'}</div></div>
        <div>${dl([['Fornitore', nm(lookups.fornitori, wv('fornitore_id'))], ['Codice fornitore', wv('codice_fornitore')], ['Codice articolo fornitore', wv('codice_articolo_fornitore')],
          ['Prezzo di acquisto', wnum('prezzo_acquisto') === null ? 'non presente' : eur(wnum('prezzo_acquisto')) + ' €']])}
        <div class="prev">${wizPreviewHtml()}</div></div></div>`;
    }
  }
}
function renderWizard() {
  const last = wiz.step === STEPS.length - 1;
  $('drawerBody').innerHTML = `
    <div class="mhead"><div class="tt"><h2>Nuovo articolo</h2><div class="sub">${wiz.from ? 'Copia di ' + esc(wiz.from) + ' – scrivi il nuovo codice e controlla i dati' : 'Compila i passaggi: il prezzo di vendita si calcola da solo'}</div></div>
      <div class="mnav"><button class="btn" id="closeDrawer" title="Chiudi">✕</button></div></div>
    <div class="mbody">
      <div class="steps">${STEPS.map((n, i) => `<span class="st ${i === wiz.step ? 'on' : i < wiz.step ? 'done' : ''}">${i + 1}. ${n}</span>`).join('')}</div>
      <div class="box ident"><h3><span>${STEPS[wiz.step]}</span></h3><div class="in">${wizBody()}<div class="err" id="wizErr" style="margin:10px 0 0;min-height:18px">${esc(wiz.err)}</div></div></div>
      <div class="wizfoot"><button class="btn" data-wiz="back" ${wiz.step === 0 ? 'disabled' : ''}>← Indietro</button>
        ${last ? '<button class="btn primary" data-wiz="save">Crea articolo</button>' : '<button class="btn primary" data-wiz="next">Avanti →</button>'}</div>
    </div>`;
  const f = $('drawerBody').querySelector('input[type=text]'); if (f && !f.value) f.focus();
}
async function wizNext() {
  wiz.err = '';
  if (wiz.step === 0) {
    const cod = String(wv('codice')).trim(), des = String(wv('descrizione')).trim();
    if (!cod) { wiz.err = 'Il codice è obbligatorio.'; return renderWizard(); }
    if (!des) { wiz.err = 'La descrizione è obbligatoria.'; return renderWizard(); }
    wiz.d.codice = cod;
    const ex = await sb.from('articoli').select('id,descrizione').eq('codice', cod).maybeSingle();
    if (ex.data) { wiz.err = `Esiste già un articolo con il codice ${cod} (${ex.data.descrizione}).`; return renderWizard(); }
  }
  if (wiz.step === 2) {
    for (const k of ['sconto_base', 'sconto_extra1', 'sconto_extra2', 'sconto_extra3']) { const v = wpct(k); if (v !== null && (isNaN(v) || v < 0 || v > 1)) { wiz.err = 'Gli sconti devono essere tra 0 e 100.'; return renderWizard(); } }
    for (const k of ['prezzo_acquisto', 'variazione_prezzo', 'ricarico_personalizzato', 'ammortamento', 'ricarico_ammortamento']) { const v = wnum(k); if (v !== null && isNaN(v)) { wiz.err = 'Controlla i numeri inseriti nel prezzo.'; return renderWizard(); } }
  }
  if (wiz.step === 3) {
    for (const k of ['lotto_economico', 'lotto_minimo_vendita', 'unita_per_confezione', 'lunghezza_barra']) { const v = wnum(k); if (v !== null && isNaN(v)) { wiz.err = 'Controlla i numeri inseriti.'; return renderWizard(); } }
  }
  wiz.step++; renderWizard();
}
async function wizSave() {
  const btn = document.querySelector('[data-wiz=save]'); btn.disabled = true; wiz.err = '';
  const T = (k) => { const v = String(wv(k)).trim(); return v === '' ? null : v; }, I = (k) => { const v = String(wv(k)).trim(); return v === '' ? null : Number(v); };
  const pl = {
    codice: T('codice'), descrizione: T('descrizione'), codice_padre: T('codice_padre'), famiglia_id: I('famiglia_id'), tipo_hardware_id: I('tipo_hardware_id'),
    colore: T('colore'), materiale_base: T('materiale_base'), unita_misura: T('unita_misura'), lotto_economico: wnum('lotto_economico'), lotto_minimo_vendita: wnum('lotto_minimo_vendita'),
    unita_per_confezione: wnum('unita_per_confezione'), lunghezza_barra: wnum('lunghezza_barra'), note: T('note'),
    fornitore_id: I('fornitore_id'), codice_fornitore: T('codice_fornitore'), codice_articolo_fornitore: T('codice_articolo_fornitore'), origine_prezzo: T('origine_prezzo') || 'listino_fornitore',
    prezzo_acquisto: wnum('prezzo_acquisto'), variazione_prezzo: wpct('variazione_prezzo') || 0,
    sconto_base: wpct('sconto_base') || 0, sconto_extra1: wpct('sconto_extra1') || 0, sconto_extra2: wpct('sconto_extra2') || 0, sconto_extra3: wpct('sconto_extra3') || 0,
    ricarico_personalizzato: wpct('ricarico_personalizzato'), attrezzatura: T('attrezzatura'), ammortamento: wnum('ammortamento'), ricarico_ammortamento: wpct('ricarico_ammortamento') || 0, obsoleto: false
  };
  if (pl.prezzo_acquisto !== null) pl.data_ultima_variazione = new Date().toISOString().slice(0, 10);
  const ins = await sb.from('articoli').insert(pl).select('id').single();
  if (ins.error) { btn.disabled = false; wiz.err = ins.error.code === '23505' ? 'Questo codice esiste già.' : 'Errore: ' + ins.error.message; return renderWizard(); }
  const id = ins.data.id;
  if (wiz.serie.size) await sb.from('articoli_sistemi').insert([...wiz.serie].map(sid => ({ articolo_id: id, sistema_id: sid })));
  if (pl.prezzo_acquisto !== null) await sb.rpc('aggiorna_prezzo_vendita', { p_articolo: id });
  wiz = null;
  $('q').value = pl.codice; Object.keys(colF).forEach(k => delete colF[k]); page = 0; buildHead(); await load();
  await openArticle(id);
}
$('newArt').addEventListener('click', () => startWizard(null));
$('drawerBody').addEventListener('input', (e) => {
  if (!wiz) return;
  if (e.target.dataset.newfor) { wiz.d[e.target.dataset.newfor] = e.target.value; return; }
  if (!e.target.dataset.k) return;
  wiz.d[e.target.dataset.k] = e.target.value;
  if (wiz.step === 2) { const p = $('wizPrev'); if (p) p.innerHTML = wizPreviewHtml(); }
});
$('drawerBody').addEventListener('click', (e) => {
  if (!wiz) return;
  const w = e.target.closest('[data-wiz]');
  if (w) { const a = w.dataset.wiz; if (a === 'back') { wiz.step--; wiz.err = ''; renderWizard(); } else if (a === 'next') wizNext(); else if (a === 'save') wizSave(); return; }
  const t = e.target.closest('.wizserie .tag.pick');
  if (t) { const id = Number(t.dataset.sid); wiz.serie.has(id) ? wiz.serie.delete(id) : wiz.serie.add(id); t.classList.toggle('sel'); }
});
/* ---------- tendine con voce nuova, autocompilazione e nuovo fornitore ---------- */
$('drawer').addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches('select[data-k="fornitore_id"]') && lookups) {
    const f = lookups.fornitori.find(x => String(x.id) === t.value), c = $('drawer').querySelector('[data-k="codice_fornitore"]');
    if (f && f.codice && c) { c.value = f.codice; c.dispatchEvent(new Event('input', { bubbles: true })); }
  }
});
$('drawer').addEventListener('click', async (e) => {
  if (e.target.closest('[data-newsup]')) {
    e.preventDefault();
    if ($('supBox')) { $('supNome').focus(); return; }
    const grid = e.target.closest('.formgrid');
    grid.insertAdjacentHTML('beforeend', `<div class="f wide editbox" id="supBox"><div class="formgrid" style="grid-template-columns:2fr 1fr auto auto;align-items:end">
      <label class="f"><span>Nome del nuovo fornitore</span><input type="text" id="supNome"></label>
      <label class="f"><span>Codice fornitore</span><input type="text" id="supCod"></label>
      <button class="btn primary" type="button" data-supsave="1">Aggiungi</button><button class="btn" type="button" data-supcancel="1">Annulla</button></div>
      <span class="err" id="supErr" style="margin:6px 0 0;min-height:0"></span></div>`);
    $('supNome').focus(); return;
  }
  const nv = e.target.closest('[data-newval]');
  if (nv) {
    e.preventDefault();
    $('valBox')?.remove();
    const k = nv.dataset.newval, grid = nv.closest('.formgrid');
    grid.insertAdjacentHTML('beforeend', `<div class="f wide editbox" id="valBox" data-for="${k}"><div class="formgrid" style="grid-template-columns:3fr auto auto;align-items:end">
      <label class="f"><span>${NEWLBL[k][1]}</span><input type="text" id="valNome"></label>
      <button class="btn primary" type="button" data-valsave="1">Aggiungi</button><button class="btn" type="button" data-valcancel="1">Annulla</button></div></div>`);
    $('valNome').focus(); return;
  }
  if (e.target.closest('[data-valcancel]')) { $('valBox')?.remove(); return; }
  if (e.target.closest('[data-valsave]')) {
    const box = $('valBox'), k = box.dataset.for;
    let val = $('valNome').value.trim().replace(/\s+/g, ' ');
    if (!val) return;
    if (k === 'colore') val = val.toUpperCase();
    const list = k === 'colore' ? lookups.fin : lookups.mat;
    const ex = list.find(x => x.toLowerCase() === val.toLowerCase());
    if (ex) val = ex; else list.push(val);
    const sel = $('drawer').querySelector(`select[data-k="${k}"]`);
    const vals = [...list].sort((a, b) => a.localeCompare(b, 'it'));
    sel.innerHTML = '<option value=""></option>' + vals.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
    sel.value = val; sel.dispatchEvent(new Event('input', { bubbles: true }));
    box.remove(); return;
  }
  if (e.target.closest('[data-supcancel]')) { $('supBox')?.remove(); return; }
  if (e.target.closest('[data-supsave]')) {
    const nome = $('supNome').value.trim().replace(/\s+/g, ' ').toUpperCase(), cod = $('supCod').value.trim();
    const err = (m) => { $('supErr').textContent = m; };
    if (!nome) return err('Scrivi il nome del fornitore.');
    let f = lookups.fornitori.find(x => x.nome.toUpperCase() === nome);
    if (!f) {
      const ins = await sb.from('fornitori').insert({ nome, codice: cod || null, attivo: true }).select('id,nome,codice').single();
      if (ins.error) return err('Errore: ' + ins.error.message);
      f = ins.data; lookups.fornitori.push(f); lookups.fornitori.sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
      fornitori = lookups.fornitori.map(x => x.nome); buildHead();
    } else if (cod && !f.codice) { await sb.from('fornitori').update({ codice: cod }).eq('id', f.id); f.codice = cod; }
    const sel = $('drawer').querySelector('select[data-k="fornitore_id"]');
    sel.innerHTML = '<option value=""></option>' + lookups.fornitori.map(o => `<option value="${o.id}">${esc(o.nome)}</option>`).join('');
    sel.value = String(f.id); sel.dispatchEvent(new Event('input', { bubbles: true }));
    const c = $('drawer').querySelector('[data-k="codice_fornitore"]');
    if (c && (f.codice || cod)) { c.value = f.codice || cod; c.dispatchEvent(new Event('input', { bubbles: true })); }
    $('supBox')?.remove();
  }
});

function closeDrawer() {
  if (wiz && !confirm('Chiudere senza creare l\'articolo? I dati inseriti andranno persi.')) return;
  wiz = null; $('veil').classList.add('hidden'); $('drawer').classList.add('hidden');
}
$('drawer').addEventListener('click', (e) => {
  if (e.target.closest('#closeDrawer')) closeDrawer();
  const n = e.target.closest('[data-nav]'); if (n) navArticle(Number(n.dataset.nav));
  const ed = e.target.closest('[data-edit]'); if (ed) startEdit(ed.dataset.edit);
  if (e.target.closest('[data-dup]')) startWizard(curArt);
  const sv = e.target.closest('[data-save]'); if (sv) saveSection(sv.dataset.save);
  if (e.target.closest('[data-cancel]')) { editing = null; renderModal(); }
  const im = e.target.closest('[data-img]'); if (im) { im.dataset.img === 'pick' ? $('imgFile').click() : removeImage(); }
});
$('veil').addEventListener('click', closeDrawer);
$('drawer').addEventListener('change', (e) => { if (e.target.id === 'imgFile' && e.target.files[0]) uploadImage(e.target.files[0]); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
  if ($('drawer').classList.contains('hidden') || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
  if (editing || wiz) return;
  if (e.key === 'ArrowLeft') navArticle(-1);
  if (e.key === 'ArrowRight') navArticle(1);
});

start();
