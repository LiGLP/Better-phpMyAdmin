'use strict';

/* ======================================================================
   Better phpMyAdmin — frontend (dependency-free)
   ====================================================================== */

const state = {
  conn: null,
  databases: [],
  tablesByDb: {},
  openDbs: new Set(),
  sel: { db: null, table: null, tab: 'browse' },
  browse: { page: 1, sort: null, dir: 'asc', search: '' },
  cfg: { rowsPerPage: 50, maxQueryRows: 5000, maxImportSizeMB: 64 },
  sqlScratch: ''
};

/* ---------- tiny helpers ---------- */
const $ = sel => document.querySelector(sel);
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const fmtBytes = n => {
  if (n == null) return '–';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; n = Number(n);
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(i ? 1 : 0) + ' ' + u[i];
};
const fmtNum = n => n == null ? '–' : Number(n).toLocaleString();

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {},
    ...opts
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const err = new Error((data && data.error) || res.statusText);
    err.data = data; err.status = res.status;
    throw err;
  }
  return data;
}

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  setTimeout(() => t.classList.add('hidden'), 3200);
}

/* ---------- modal ---------- */
function openModal(html) {
  $('#modal').innerHTML = html;
  $('#modalOverlay').classList.remove('hidden');
}
function closeModal() { $('#modalOverlay').classList.add('hidden'); }
$('#modalOverlay').addEventListener('click', e => { if (e.target.id === 'modalOverlay') closeModal(); });

function confirmDialog(title, message, onYes, danger = true) {
  openModal(`
    <h3>${esc(title)}</h3>
    <p class="muted">${message}</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="mCancel">Cancel</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="mOk">Confirm</button>
    </div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => { closeModal(); await onYes(); };
}

/* ======================================================================
   Auth / boot
   ====================================================================== */
async function boot() {
  // theme
  const saved = localStorage.getItem('bpma-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);

  try {
    const s = await api('/auth/session');
    if (s.authenticated) { state.conn = s; await startApp(); return; }
  } catch (_) {}
  await showLogin();
}

async function showLogin() {
  $('#login').classList.remove('hidden');
  $('#app').classList.add('hidden');
  try {
    const d = await api('/auth/defaults');
    $('#lHost').value = d.host || '127.0.0.1';
    $('#lPort').value = d.port || 3306;
    $('#lUser').value = d.user || 'root';
  } catch (_) {}
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#loginBtn');
  $('#loginError').textContent = '';
  btn.disabled = true; btn.textContent = 'Connecting…';
  try {
    const body = JSON.stringify({
      host: $('#lHost').value, port: $('#lPort').value,
      user: $('#lUser').value, password: $('#lPass').value
    });
    const s = await api('/auth/login', { method: 'POST', body });
    state.conn = s;
    await startApp();
  } catch (err) {
    $('#loginError').textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Connect';
  }
});

async function startApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#connInfo').textContent = `${state.conn.user}@${state.conn.host}:${state.conn.port} · MySQL ${state.conn.version || ''}`;
  try { state.cfg = await api('/config'); } catch (_) {}
  await loadDatabases();
  renderWelcome();
}

$('#logoutBtn').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  state.conn = null; state.databases = []; state.tablesByDb = {}; state.openDbs.clear();
  await showLogin();
});

$('#themeToggle').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', cur);
  localStorage.setItem('bpma-theme', cur);
});

/* ======================================================================
   Sidebar tree
   ====================================================================== */
async function loadDatabases() {
  try {
    state.databases = await api('/databases');
    renderTree();
  } catch (err) { toast('Failed to load databases: ' + err.message, 'err'); }
}

async function loadTables(db) {
  state.tablesByDb[db] = await api(`/databases/${encodeURIComponent(db)}/tables`);
}

function renderTree() {
  const filter = $('#dbFilter').value.trim().toLowerCase();
  const tree = $('#dbTree');
  tree.innerHTML = '';

  for (const db of state.databases) {
    const tables = state.tablesByDb[db.name] || [];
    const dbMatch = !filter || db.name.toLowerCase().includes(filter);
    const matchTables = filter ? tables.filter(t => t.name.toLowerCase().includes(filter)) : tables;
    if (filter && !dbMatch && matchTables.length === 0) continue;

    const open = state.openDbs.has(db.name) || (filter && matchTables.length > 0);
    const dbEl = document.createElement('div');
    dbEl.className = 'tree-db' + (open ? ' open' : '') + (db.system ? ' system' : '');

    const shown = open ? tables : [];
    dbEl.innerHTML = `
      <div class="tree-db-head ${state.sel.db === db.name && !state.sel.table ? 'active' : ''}" data-db="${esc(db.name)}">
        <span class="tree-caret">▶</span>
        <span class="tree-db-name" title="${esc(db.name)}">${esc(db.name)}</span>
        <span class="tree-badge">${db.tableCount}</span>
      </div>
      <div class="tree-tables">
        ${(filter ? matchTables : shown).map(t => `
          <div class="tree-table ${t.type} ${state.sel.db === db.name && state.sel.table === t.name ? 'active' : ''}"
               data-db="${esc(db.name)}" data-table="${esc(t.name)}">
            <span class="ico">${t.type === 'view' ? '👁' : '▦'}</span>
            <span title="${esc(t.name)}">${esc(t.name)}</span>
          </div>`).join('')}
      </div>`;
    tree.appendChild(dbEl);
  }

  // caret / db-head click → toggle + select db
  tree.querySelectorAll('.tree-db-head').forEach(head => {
    head.addEventListener('click', async () => {
      const db = head.dataset.db;
      if (state.openDbs.has(db)) {
        state.openDbs.delete(db);
        renderTree();
      } else {
        state.openDbs.add(db);
        if (!state.tablesByDb[db]) { try { await loadTables(db); } catch (e) { toast(e.message, 'err'); } }
        renderTree();
      }
      selectDatabase(db);
    });
  });
  tree.querySelectorAll('.tree-table').forEach(row => {
    row.addEventListener('click', e => {
      e.stopPropagation();
      selectTable(row.dataset.db, row.dataset.table, 'browse');
    });
  });
}

$('#dbFilter').addEventListener('input', renderTree);
$('#refreshDbs').addEventListener('click', async () => {
  state.tablesByDb = {};
  for (const db of state.openDbs) { try { await loadTables(db); } catch (_) {} }
  await loadDatabases();
  toast('Refreshed', 'ok');
});
$('#newDbBtn').addEventListener('click', newDatabaseDialog);

/* ======================================================================
   Selection / panel routing
   ====================================================================== */
function selectDatabase(db) {
  state.sel = { db, table: null, tab: 'tables' };
  renderTree();
  renderDatabaseView(db);
}

async function selectTable(db, table, tab) {
  state.sel = { db, table, tab: tab || 'browse' };
  state.browse = { page: 1, sort: null, dir: 'asc', search: '' };
  if (!state.tablesByDb[db]) { state.openDbs.add(db); try { await loadTables(db); } catch (_) {} }
  renderTree();
  renderTablePanel();
}

/* ======================================================================
   Welcome / server view
   ====================================================================== */
function renderWelcome() {
  const totalTables = state.databases.reduce((a, d) => a + d.tableCount, 0);
  const userDbs = state.databases.filter(d => !d.system);
  $('#main').innerHTML = `
    <div class="panel-head">
      <div class="panel-title">🐬 Server overview</div>
      <div class="panel-actions">
        <button class="btn" id="wNewDb">＋ New database</button>
        <button class="btn btn-primary" id="wSql">SQL console</button>
      </div>
    </div>
    <div class="panel-body">
      <div class="server-stats">
        <div class="stat"><div class="num">${state.databases.length}</div><div class="lbl">Databases</div></div>
        <div class="stat"><div class="num">${totalTables}</div><div class="lbl">Tables</div></div>
        <div class="stat"><div class="num">${esc(state.conn.version || '?')}</div><div class="lbl">Server</div></div>
      </div>
      <div class="section-title">Your databases</div>
      <div class="cards">
        ${userDbs.map(d => `
          <div class="card" data-db="${esc(d.name)}">
            <h3>🗄 ${esc(d.name)}</h3>
            <div class="meta">${d.tableCount} table${d.tableCount === 1 ? '' : 's'}</div>
          </div>`).join('') || '<p class="muted">No user databases yet. Create one to get started.</p>'}
      </div>
    </div>`;
  $('#wNewDb').onclick = newDatabaseDialog;
  $('#wSql').onclick = () => { state.sel = { db: null, table: null, tab: 'sql' }; renderGlobalSql(); };
  $('#main').querySelectorAll('.card').forEach(c => c.onclick = () => selectDatabase(c.dataset.db));
}

/* ======================================================================
   Database view (table list)
   ====================================================================== */
async function renderDatabaseView(db) {
  const main = $('#main');
  main.innerHTML = `
    <div class="panel-head">
      <div class="panel-title">🗄 <span>${esc(db)}</span></div>
      <div class="panel-actions">
        <button class="btn" id="dNewTable">＋ New table</button>
        <button class="btn" id="dSql">SQL</button>
        <button class="btn" id="dExport">⬇ Export</button>
        <button class="btn" id="dImport">⬆ Import</button>
        <button class="btn btn-danger" id="dDrop">Drop database</button>
      </div>
    </div>
    <div class="panel-body"><div class="loading"><span class="spinner"></span> Loading tables…</div></div>`;

  $('#dSql').onclick = () => renderGlobalSql(db);
  $('#dExport').onclick = () => renderExportView(db);
  $('#dImport').onclick = () => renderImportView(db);
  $('#dNewTable').onclick = () => newTableDialog(db);
  $('#dDrop').onclick = () => confirmDialog('Drop database',
    `This permanently deletes <b>${esc(db)}</b> and all its tables.`, async () => {
      try {
        await api(`/databases/${encodeURIComponent(db)}`, { method: 'DELETE' });
        state.openDbs.delete(db); delete state.tablesByDb[db];
        await loadDatabases(); renderWelcome();
        toast('Database dropped', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    });

  try {
    await loadTables(db);
    const tables = state.tablesByDb[db];
    const body = main.querySelector('.panel-body');
    if (tables.length === 0) {
      body.innerHTML = '<p class="muted">This database has no tables yet.</p>';
      return;
    }
    body.innerHTML = `
      <div class="grid-wrap">
        <table class="grid">
          <thead><tr>
            <th>Table</th><th>Type</th><th>Engine</th><th>Rows</th><th>Size</th><th></th>
          </tr></thead>
          <tbody>
            ${tables.map(t => `
              <tr data-table="${esc(t.name)}" data-type="${t.type}">
                <td class="mono"><a href="#" class="tbl-link">${t.type === 'view' ? '👁' : '▦'} ${esc(t.name)}</a></td>
                <td>${t.type}</td>
                <td>${esc(t.engine || '–')}</td>
                <td class="num">${t.rows == null ? '–' : fmtNum(t.rows)}</td>
                <td class="num">${fmtBytes(t.size)}</td>
                <td class="row-actions">
                  <button class="btn btn-sm" data-act="browse">Browse</button>
                  <button class="btn btn-sm" data-act="structure">Structure</button>
                  <button class="btn btn-sm btn-danger" data-act="drop">Drop</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    body.querySelectorAll('tr[data-table]').forEach(tr => {
      const name = tr.dataset.table;
      tr.querySelector('.tbl-link').onclick = e => { e.preventDefault(); selectTable(db, name, 'browse'); };
      tr.querySelectorAll('[data-act]').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          const act = btn.dataset.act;
          if (act === 'drop') return dropTable(db, name);
          selectTable(db, name, act);
        };
      });
    });
  } catch (e) {
    main.querySelector('.panel-body').innerHTML = `<p class="danger-text">${esc(e.message)}</p>`;
  }
}

function dropTable(db, table) {
  confirmDialog('Drop table', `Permanently delete table <b>${esc(table)}</b>?`, async () => {
    try {
      await api(`/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}`, { method: 'DELETE' });
      delete state.tablesByDb[db];
      await loadTables(db); await loadDatabases();
      if (state.sel.table === table) selectDatabase(db); else renderDatabaseView(db);
      toast('Table dropped', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  });
}

/* ======================================================================
   Table panel (Browse / Structure / SQL / Export)
   ====================================================================== */
function tableHead() {
  const { db, table, tab } = state.sel;
  const tabs = [
    ['browse', 'Browse'], ['structure', 'Structure'],
    ['insert', 'Insert'], ['sql', 'SQL'], ['export', 'Export']
  ];
  return `
    <div class="panel-head">
      <div class="panel-title">▦ <span class="crumb">${esc(db)} ›</span> ${esc(table)}</div>
      <div class="panel-actions">
        <button class="btn btn-sm" id="thRefresh">⟳ Refresh</button>
        <button class="btn btn-sm btn-danger" id="thDrop">Drop</button>
      </div>
    </div>
    <div class="tabs">
      ${tabs.map(([k, label]) => `<div class="tab ${tab === k ? 'active' : ''}" data-tab="${k}">${label}</div>`).join('')}
    </div>
    <div class="panel-body" id="tBody"></div>`;
}

function renderTablePanel() {
  $('#main').innerHTML = tableHead();
  $('#thRefresh').onclick = renderTablePanel;
  $('#thDrop').onclick = () => dropTable(state.sel.db, state.sel.table);
  $('#main').querySelectorAll('.tab').forEach(t => {
    t.onclick = () => { state.sel.tab = t.dataset.tab; renderTablePanel(); };
  });
  const tab = state.sel.tab;
  if (tab === 'browse') renderBrowse();
  else if (tab === 'structure') renderStructure();
  else if (tab === 'insert') renderInsert();
  else if (tab === 'sql') renderTableSql();
  else if (tab === 'export') renderExportView(state.sel.db, state.sel.table);
}

/* ---------- Browse ---------- */
async function renderBrowse() {
  const { db, table } = state.sel;
  const b = state.browse;
  const body = $('#tBody');
  body.innerHTML = '<div class="loading"><span class="spinner"></span> Loading rows…</div>';

  const params = new URLSearchParams({
    page: b.page, perPage: state.cfg.rowsPerPage,
    ...(b.sort ? { sort: b.sort, dir: b.dir } : {}),
    ...(b.search ? { search: b.search } : {})
  });
  let data;
  try {
    data = await api(`/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}/rows?${params}`);
  } catch (e) { body.innerHTML = `<p class="danger-text">${esc(e.message)}</p>`; return; }

  state.browse.data = data;
  const pk = data.primaryKey || [];
  const totalPages = Math.max(1, Math.ceil(data.total / data.perPage));

  body.innerHTML = `
    <div class="sql-bar" style="margin:0 0 14px;">
      <input type="search" id="bSearch" placeholder="Search all columns…" value="${esc(b.search)}" style="max-width:280px;">
      <button class="btn btn-sm" id="bSearchBtn">Search</button>
      <button class="btn btn-sm btn-primary" id="bInsert">＋ Insert row</button>
      <span class="spacer" style="flex:1"></span>
      <span class="muted">${fmtNum(data.total)} row${data.total === 1 ? '' : 's'}</span>
    </div>
    <div class="grid-wrap">
      <table class="grid">
        <thead><tr>
          <th style="width:1px"></th>
          ${data.columns.map(c => `
            <th data-col="${esc(c)}">${esc(c)}${b.sort === c ? `<span class="sort-arrow">${b.dir === 'asc' ? '▲' : '▼'}</span>` : ''}</th>`).join('')}
        </tr></thead>
        <tbody>
          ${data.rows.map((row, i) => `
            <tr data-i="${i}">
              <td class="row-actions">
                <button class="btn btn-sm" data-act="edit" title="Edit">✎</button>
                <button class="btn btn-sm btn-danger" data-act="del" title="Delete">✕</button>
              </td>
              ${data.columns.map(c => cellHtml(row[c])).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="pager">
      <button class="btn btn-sm" id="pgFirst" ${b.page <= 1 ? 'disabled' : ''}>« First</button>
      <button class="btn btn-sm" id="pgPrev" ${b.page <= 1 ? 'disabled' : ''}>‹ Prev</button>
      <span class="page-info">Page ${b.page} / ${totalPages}</span>
      <button class="btn btn-sm" id="pgNext" ${b.page >= totalPages ? 'disabled' : ''}>Next ›</button>
      <button class="btn btn-sm" id="pgLast" ${b.page >= totalPages ? 'disabled' : ''}>Last »</button>
      <span class="spacer"></span>
    </div>`;

  if (data.rows.length === 0) {
    body.querySelector('.grid-wrap').innerHTML = '<p class="muted" style="padding:20px;">No rows match.</p>';
  }

  // header sort
  body.querySelectorAll('th[data-col]').forEach(th => {
    th.onclick = () => {
      const col = th.dataset.col;
      if (b.sort === col) b.dir = b.dir === 'asc' ? 'desc' : 'asc';
      else { b.sort = col; b.dir = 'asc'; }
      b.page = 1; renderBrowse();
    };
  });
  // search
  const doSearch = () => { b.search = $('#bSearch').value.trim(); b.page = 1; renderBrowse(); };
  $('#bSearchBtn').onclick = doSearch;
  $('#bSearch').onkeydown = e => { if (e.key === 'Enter') doSearch(); };
  $('#bInsert').onclick = () => openRowEditor('insert', null);
  // pager
  $('#pgFirst').onclick = () => { b.page = 1; renderBrowse(); };
  $('#pgPrev').onclick = () => { b.page--; renderBrowse(); };
  $('#pgNext').onclick = () => { b.page++; renderBrowse(); };
  $('#pgLast').onclick = () => { b.page = totalPages; renderBrowse(); };
  // row actions
  body.querySelectorAll('tr[data-i]').forEach(tr => {
    const row = data.rows[Number(tr.dataset.i)];
    tr.querySelector('[data-act="edit"]').onclick = () => openRowEditor('edit', row);
    tr.querySelector('[data-act="del"]').onclick = () => deleteRow(row, pk, data.columns);
  });
}

function cellHtml(v) {
  if (v === null || v === undefined) return '<td class="null">NULL</td>';
  if (typeof v === 'number') return `<td class="num">${esc(v)}</td>`;
  const s = String(v);
  const cls = /^\d+$/.test(s) ? 'mono' : '';
  return `<td class="${cls}" title="${esc(s)}">${esc(s.length > 200 ? s.slice(0, 200) + '…' : s)}</td>`;
}

/* ---------- Row editor (insert / edit) ---------- */
async function openRowEditor(mode, row) {
  const { db, table } = state.sel;
  let struct;
  try {
    struct = await api(`/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}/structure`);
  } catch (e) { return toast(e.message, 'err'); }

  const fields = struct.columns.map(c => {
    const val = row ? row[c.name] : (c.default != null ? c.default : '');
    const isNull = row ? row[c.name] === null : (c.nullable && c.default == null);
    const auto = /auto_increment/i.test(c.extra || '');
    return `
      <label>
        <span>${esc(c.name)} <span class="muted">${esc(c.type)}${c.key === 'PRI' ? ' 🔑' : ''}${auto ? ' · auto' : ''}</span></span>
        <div class="inline">
          <textarea rows="1" data-col="${esc(c.name)}" ${isNull ? 'disabled' : ''} style="font-family:var(--mono);min-height:36px;">${esc(isNull ? '' : val)}</textarea>
          ${c.nullable ? `<label class="checkbox-row" style="margin:0;white-space:nowrap;"><input type="checkbox" data-null="${esc(c.name)}" ${isNull ? 'checked' : ''}> NULL</label>` : ''}
        </div>
      </label>`;
  }).join('');

  openModal(`
    <h3>${mode === 'insert' ? 'Insert row' : 'Edit row'} <span class="muted">· ${esc(table)}</span></h3>
    <div id="rowForm">${fields}</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="rCancel">Cancel</button>
      <button class="btn btn-primary" id="rSave">${mode === 'insert' ? 'Insert' : 'Save'}</button>
    </div>`);

  $('#modal').querySelectorAll('input[data-null]').forEach(cb => {
    cb.onchange = () => {
      const ta = $('#modal').querySelector(`textarea[data-col="${CSS.escape(cb.dataset.null)}"]`);
      ta.disabled = cb.checked;
      if (cb.checked) ta.value = '';
    };
  });
  $('#rCancel').onclick = closeModal;
  $('#rSave').onclick = async () => {
    const values = {};
    $('#modal').querySelectorAll('textarea[data-col]').forEach(ta => {
      const col = ta.dataset.col;
      const cb = $('#modal').querySelector(`input[data-null="${CSS.escape(col)}"]`);
      if (cb && cb.checked) { values[col] = null; return; }
      // For insert, skip empty auto-increment so the DB assigns it.
      if (mode === 'insert' && ta.value === '') {
        const c = struct.columns.find(x => x.name === col);
        if (c && (/auto_increment/i.test(c.extra || '') || c.default != null)) return;
      }
      values[col] = ta.value;
    });
    try {
      if (mode === 'insert') {
        await api(`/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}/rows`,
          { method: 'POST', body: JSON.stringify({ values }) });
        toast('Row inserted', 'ok');
      } else {
        const where = buildWhere(row, state.browse.data.primaryKey, state.browse.data.columns);
        await api(`/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}/rows`,
          { method: 'PUT', body: JSON.stringify({ values, where }) });
        toast('Row updated', 'ok');
      }
      closeModal(); renderBrowse();
    } catch (e) { toast(e.message, 'err'); }
  };
}

function buildWhere(row, pk, columns) {
  const keys = (pk && pk.length) ? pk : columns;
  const where = {};
  for (const k of keys) where[k] = row[k];
  return where;
}

function deleteRow(row, pk, columns) {
  confirmDialog('Delete row', 'This permanently deletes the selected row.', async () => {
    try {
      const where = buildWhere(row, pk, columns);
      await api(`/databases/${encodeURIComponent(state.sel.db)}/tables/${encodeURIComponent(state.sel.table)}/rows`,
        { method: 'DELETE', body: JSON.stringify({ where }) });
      toast('Row deleted', 'ok'); renderBrowse();
    } catch (e) { toast(e.message, 'err'); }
  });
}

/* ---------- Insert tab (opens editor) ---------- */
function renderInsert() {
  $('#tBody').innerHTML = '<p class="muted">Opening insert form…</p>';
  openRowEditor('insert', null);
}

/* ---------- Structure ---------- */
async function renderStructure() {
  const { db, table } = state.sel;
  const body = $('#tBody');
  body.innerHTML = '<div class="loading"><span class="spinner"></span> Loading structure…</div>';
  try {
    const s = await api(`/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}/structure`);
    const create = await api(`/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}/create`);
    body.innerHTML = `
      <div class="section-title">Columns</div>
      <div class="grid-wrap">
        <table class="grid">
          <thead><tr><th>#</th><th>Name</th><th>Type</th><th>Null</th><th>Key</th><th>Default</th><th>Extra</th></tr></thead>
          <tbody>
            ${s.columns.map((c, i) => `
              <tr>
                <td class="num">${i + 1}</td>
                <td class="mono"><b>${esc(c.name)}</b>${c.key === 'PRI' ? '<span class="key-tag">PK</span>' : ''}${c.key === 'UNI' ? '<span class="key-tag uni">UQ</span>' : ''}</td>
                <td class="mono">${esc(c.type)}</td>
                <td>${c.nullable ? 'YES' : 'NO'}</td>
                <td>${esc(c.key || '')}</td>
                <td class="${c.default == null ? 'null' : 'mono'}">${c.default == null ? 'NULL' : esc(c.default)}</td>
                <td class="muted">${esc(c.extra || '')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="section-title">Indexes</div>
      ${s.indexes.length ? `
      <div class="grid-wrap">
        <table class="grid">
          <thead><tr><th>Name</th><th>Column</th><th>Unique</th><th>Type</th></tr></thead>
          <tbody>
            ${s.indexes.map(ix => `
              <tr><td class="mono">${esc(ix.name)}</td><td class="mono">${esc(ix.column)}</td>
              <td>${ix.nonUnique == 0 ? 'YES' : 'no'}</td><td>${esc(ix.type)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<p class="muted">No indexes.</p>'}
      <div class="section-title">Create statement</div>
      <pre class="create-sql">${esc(create.sql)}</pre>`;
  } catch (e) { body.innerHTML = `<p class="danger-text">${esc(e.message)}</p>`; }
}

/* ======================================================================
   SQL console (table-scoped, db-scoped, global)
   ====================================================================== */
function sqlConsole(db, presetSql) {
  return `
    <textarea class="sql-editor" id="sqlBox" placeholder="SELECT * FROM ...">${esc(presetSql || state.sqlScratch || '')}</textarea>
    <div class="sql-bar">
      <button class="btn btn-primary" id="sqlRun">▶ Run <span class="muted">(Ctrl+Enter)</span></button>
      ${db ? `<span class="sql-hint">Running on <b>${esc(db)}</b></span>` : '<span class="sql-hint">No database selected — use fully-qualified names or <code>USE db;</code></span>'}
      <span class="spacer" style="flex:1"></span>
      <button class="btn btn-sm" id="sqlClear">Clear</button>
    </div>
    <div id="sqlResult"></div>`;
}

function wireSql(db) {
  const run = async () => {
    const sql = $('#sqlBox').value;
    state.sqlScratch = sql;
    if (!sql.trim()) return;
    const out = $('#sqlResult');
    out.innerHTML = '<div class="loading"><span class="spinner"></span> Running…</div>';
    try {
      const r = await api('/query', { method: 'POST', body: JSON.stringify({ sql, db: db || undefined }) });
      out.innerHTML = renderQueryResult(r);
    } catch (e) {
      out.innerHTML = `<div class="result-meta"><span class="pill err">Error</span></div>
        <p class="danger-text">${esc(e.message)}</p>`;
    }
  };
  $('#sqlRun').onclick = run;
  $('#sqlClear').onclick = () => { $('#sqlBox').value = ''; state.sqlScratch = ''; $('#sqlResult').innerHTML = ''; };
  $('#sqlBox').addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
    if (e.key === 'Tab') { e.preventDefault(); const t = e.target, s = t.selectionStart;
      t.value = t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd); t.selectionStart = t.selectionEnd = s + 2; }
  });
}

function renderQueryResult(r) {
  if (r.type === 'ok') {
    return `<div class="result-meta">
      <span class="pill ok">OK</span>
      <span class="pill">${fmtNum(r.affectedRows)} row(s) affected</span>
      ${r.insertId ? `<span class="pill">insertId ${r.insertId}</span>` : ''}
      <span class="pill">${r.elapsedMs} ms</span>
      ${r.info ? `<span class="muted">${esc(r.info)}</span>` : ''}
    </div>`;
  }
  const meta = `<div class="result-meta">
    <span class="pill ok">${fmtNum(r.rowCount)} row(s)</span>
    <span class="pill">${r.elapsedMs} ms</span>
    ${r.truncated ? `<span class="pill err">truncated to ${fmtNum(state.cfg.maxQueryRows)}</span>` : ''}
  </div>`;
  if (!r.rows.length) return meta + '<p class="muted">Empty result set.</p>';
  return meta + `
    <div class="grid-wrap">
      <table class="grid">
        <thead><tr>${r.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>
          ${r.rows.map(row => `<tr>${r.columns.map(c => cellHtml(row[c])).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderTableSql() {
  const { db, table } = state.sel;
  $('#tBody').innerHTML = sqlConsole(db, `SELECT * FROM \`${table}\` LIMIT 100;`);
  wireSql(db);
}

function renderGlobalSql(db) {
  state.sel = { db: db || null, table: null, tab: 'sql' };
  renderTree();
  $('#main').innerHTML = `
    <div class="panel-head">
      <div class="panel-title">⚡ SQL console ${db ? `<span class="crumb">· ${esc(db)}</span>` : ''}</div>
    </div>
    <div class="panel-body">${sqlConsole(db, '')}</div>`;
  wireSql(db);
}

/* ======================================================================
   Export / Import
   ====================================================================== */
function renderExportView(db, table) {
  const main = table ? $('#tBody') : $('#main');
  const inner = `
    <div class="form-grid">
      <p class="help-text">Generate a SQL dump${table ? ` of <b>${esc(table)}</b>` : ` of database <b>${esc(db)}</b>`}.</p>
      <div class="checkbox-row"><input type="checkbox" id="exData" checked> <label for="exData">Include data (INSERT statements)</label></div>
      <div class="checkbox-row"><input type="checkbox" id="exDrop"> <label for="exDrop">Add DROP TABLE before each CREATE</label></div>
      <div class="inline">
        <button class="btn btn-primary" id="exGo">⬇ Download .sql</button>
        ${table ? '<button class="btn" id="exCsv">⬇ Download .csv</button>' : ''}
      </div>
    </div>`;
  if (table) { main.innerHTML = inner; }
  else {
    main.innerHTML = `
      <div class="panel-head"><div class="panel-title">⬇ Export <span class="crumb">· ${esc(db)}</span></div>
        <div class="panel-actions"><button class="btn" id="exBack">← Back</button></div></div>
      <div class="panel-body">${inner}</div>`;
    $('#exBack').onclick = () => renderDatabaseView(db);
  }
  $('#exGo').onclick = () => {
    const p = new URLSearchParams({ data: $('#exData').checked ? '1' : '0', drop: $('#exDrop').checked ? '1' : '0' });
    if (table) p.set('table', table);
    window.location = `/api/databases/${encodeURIComponent(db)}/export?${p}`;
  };
  if (table) $('#exCsv').onclick = () =>
    window.location = `/api/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}/export.csv`;
}

function renderImportView(db) {
  $('#main').innerHTML = `
    <div class="panel-head"><div class="panel-title">⬆ Import <span class="crumb">· ${esc(db)}</span></div>
      <div class="panel-actions"><button class="btn" id="imBack">← Back</button></div></div>
    <div class="panel-body">
      <div class="form-grid">
        <p class="help-text">Upload a <b>.sql</b> file to execute against <b>${esc(db)}</b>. Max ${state.cfg.maxImportSizeMB} MB.</p>
        <label>SQL file <input type="file" id="imFile" accept=".sql,text/plain"></label>
        <div class="inline"><button class="btn btn-primary" id="imGo">⬆ Import</button></div>
        <div id="imResult"></div>
      </div>
    </div>`;
  $('#imBack').onclick = () => renderDatabaseView(db);
  $('#imGo').onclick = async () => {
    const f = $('#imFile').files[0];
    if (!f) return toast('Choose a file first', 'err');
    const fd = new FormData();
    fd.append('file', f); fd.append('db', db);
    const out = $('#imResult');
    out.innerHTML = '<div class="loading"><span class="spinner"></span> Importing…</div>';
    try {
      const r = await api('/databases/import', { method: 'POST', body: fd });
      out.innerHTML = `<div class="result-meta"><span class="pill ok">Imported</span>
        <span class="pill">${fmtBytes(r.bytes)}</span><span class="pill">${r.elapsedMs} ms</span></div>`;
      delete state.tablesByDb[db]; await loadTables(db); await loadDatabases(); renderTree();
      toast('Import complete', 'ok');
    } catch (e) {
      out.innerHTML = `<div class="result-meta"><span class="pill err">Failed</span></div><p class="danger-text">${esc(e.message)}</p>`;
    }
  };
}

/* ======================================================================
   Create database / table dialogs
   ====================================================================== */
function newDatabaseDialog() {
  openModal(`
    <h3>New database</h3>
    <label>Name <input id="ndName" placeholder="my_database" autofocus></label>
    <label>Charset
      <select id="ndCharset">
        <option value="utf8mb4">utf8mb4 (recommended)</option>
        <option value="utf8">utf8</option>
        <option value="latin1">latin1</option>
      </select>
    </label>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="ndCancel">Cancel</button>
      <button class="btn btn-primary" id="ndOk">Create</button>
    </div>`);
  $('#ndCancel').onclick = closeModal;
  $('#ndOk').onclick = async () => {
    const name = $('#ndName').value.trim();
    if (!name) return toast('Name required', 'err');
    try {
      await api('/databases', { method: 'POST', body: JSON.stringify({ name, charset: $('#ndCharset').value }) });
      closeModal(); await loadDatabases(); selectDatabase(name);
      toast('Database created', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
}

function newTableDialog(db) {
  // Minimal create-table builder; advanced users can use the SQL console.
  let colCount = 0;
  const colRow = () => {
    colCount++;
    return `<tr data-c="${colCount}">
      <td><input placeholder="column_name" data-f="name"></td>
      <td><input placeholder="INT / VARCHAR(255) / TEXT…" data-f="type" value="VARCHAR(255)"></td>
      <td style="text-align:center"><input type="checkbox" data-f="null"></td>
      <td style="text-align:center"><input type="checkbox" data-f="pk"></td>
      <td style="text-align:center"><input type="checkbox" data-f="ai"></td>
      <td><button class="btn btn-sm btn-danger" data-f="rm">✕</button></td>
    </tr>`;
  };
  openModal(`
    <h3>New table <span class="muted">· ${esc(db)}</span></h3>
    <label>Table name <input id="ntName" placeholder="my_table"></label>
    <div class="grid-wrap" style="margin-bottom:12px;">
      <table class="grid"><thead><tr>
        <th>Name</th><th>Type</th><th>Null</th><th>PK</th><th>A_I</th><th></th>
      </tr></thead><tbody id="ntCols">${colRow()}${colRow()}</tbody></table>
    </div>
    <button class="btn btn-sm" id="ntAdd">＋ Add column</button>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="ntCancel">Cancel</button>
      <button class="btn btn-primary" id="ntOk">Create table</button>
    </div>`);
  const wireRm = () => $('#ntCols').querySelectorAll('[data-f="rm"]').forEach(b =>
    b.onclick = () => b.closest('tr').remove());
  wireRm();
  $('#ntAdd').onclick = () => { $('#ntCols').insertAdjacentHTML('beforeend', colRow()); wireRm(); };
  $('#ntCancel').onclick = closeModal;
  $('#ntOk').onclick = async () => {
    const name = $('#ntName').value.trim();
    if (!name) return toast('Table name required', 'err');
    const defs = []; const pks = [];
    $('#ntCols').querySelectorAll('tr').forEach(tr => {
      const get = f => tr.querySelector(`[data-f="${f}"]`);
      const cn = get('name').value.trim();
      if (!cn) return;
      let def = `\`${cn}\` ${get('type').value.trim() || 'VARCHAR(255)'}`;
      def += get('null').checked ? ' NULL' : ' NOT NULL';
      if (get('ai').checked) def += ' AUTO_INCREMENT';
      if (get('pk').checked) pks.push(`\`${cn}\``);
      defs.push(def);
    });
    if (!defs.length) return toast('Add at least one column', 'err');
    if (pks.length) defs.push(`PRIMARY KEY (${pks.join(', ')})`);
    const sql = `CREATE TABLE \`${db}\`.\`${name}\` (\n  ${defs.join(',\n  ')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
    try {
      await api('/query', { method: 'POST', body: JSON.stringify({ sql, db }) });
      closeModal(); delete state.tablesByDb[db]; await loadTables(db); await loadDatabases();
      selectTable(db, name, 'structure');
      toast('Table created', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
}

/* ---------- go ---------- */
boot();
