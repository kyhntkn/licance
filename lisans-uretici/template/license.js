// Lisans modülü (ana süreç). lisans-baslat.js bunu boot() ile çalıştırır; uygulamanın kendi main dosyası lisans geçerliyse yüklenir.
'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, MenuItem, clipboard } = require('electron');
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const { machineIdSync } = require('node-machine-id');
const PUBLIC_KEY = require('./public-key');

const STATE_SECRET = 'LS-' + crypto.createHash('sha256').update(PUBLIC_KEY || 'x').digest('hex').slice(0, 16);
const DAY = 864e5;
let cfg = { product: '', trialDays: 14, main: 'main.js' };
let actWin = null, actMode = 'gate', finished = false, proceed = null;
const udata = f => path.join(app.getPath('userData'), f);

// ---------- makine kodu ----------
function machineCode() {
  const h = crypto.createHash('sha256').update('mc|' + machineIdSync()).digest('hex').slice(0, 20).toUpperCase();
  return h.match(/.{5}/g).join('-');
}
const rawCode = () => machineCode().replace(/-/g, '');

// ---------- deneme süresi + saat geri alma ----------
const mac = (a, b) => crypto.createHmac('sha256', STATE_SECRET + rawCode()).update(a + '|' + b).digest('hex');
function loadState(now) {
  const f = udata('.lstate');
  if (!fs.existsSync(f)) {
    const s = { first: now, last: now }; s.mac = mac(s.first, s.last);
    fs.writeFileSync(f, JSON.stringify(s)); return s;
  }
  try {
    const s = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (s.mac !== mac(s.first, s.last)) return { tampered: true };
    if (now < s.last - 10 * 60 * 1000) return { rollback: true };
    s.last = Math.max(s.last, now); s.mac = mac(s.first, s.last);
    fs.writeFileSync(f, JSON.stringify(s)); return s;
  } catch { return { tampered: true }; }
}

// ---------- lisans kodu ----------
function parse(text) {
  let t = String(text || '').trim();
  if (t[0] !== '{') t = Buffer.from(t.replace(/\s+/g, '').replace(/^LIC1\./, ''), 'base64').toString('utf8');
  const o = JSON.parse(t);
  if (!o.payload || !o.sig) throw new Error('eksik');
  return o;
}
function verifyText(text) {
  if (!PUBLIC_KEY) return { ok: false, reason: 'Açık anahtar tanımlı değil (derleme hatası).' };
  let o;
  try { o = parse(text); } catch { return { ok: false, reason: 'Lisans kodu okunamadı. Kodu eksiksiz yapıştırdığınızdan emin olun.' }; }
  try {
    if (!crypto.verify(null, Buffer.from(o.payload), crypto.createPublicKey(PUBLIC_KEY), Buffer.from(o.sig, 'base64')))
      return { ok: false, reason: 'Geçersiz lisans kodu.' };
    const p = JSON.parse(o.payload);
    if (p.product !== cfg.product) return { ok: false, reason: 'Bu lisans başka bir ürüne ait (' + p.product + ').' };
    if (p.machine !== rawCode()) return { ok: false, reason: 'Bu lisans başka bir bilgisayar için üretilmiş. Her bilgisayar için ayrı lisans gerekir.' };
    const end = new Date(p.expires + 'T23:59:59').getTime();
    if (Date.now() > end) return { ok: false, reason: 'Lisans süresi dolmuş (' + p.expires + ').' };
    return { ok: true, p, daysLeft: Math.ceil((end - Date.now()) / DAY) };
  } catch { return { ok: false, reason: 'Lisans doğrulanamadı.' }; }
}

function status() {
  const now = Date.now(), st = loadState(now);
  if (st.tampered) return { ok: false, reason: 'Uygulama verisi bozulmuş.' };
  if (st.rollback) return { ok: false, reason: 'Sistem saati geri alınmış. Lütfen saati düzeltin.' };
  const lf = udata('license.lic');
  if (fs.existsSync(lf)) {
    const v = verifyText(fs.readFileSync(lf, 'utf8'));
    if (v.ok) return { ok: true, mode: 'licensed', customer: v.p.customer, modules: v.p.modules || [], expires: v.p.expires, daysLeft: v.daysLeft };
    return { ok: false, mode: 'expired', reason: v.reason };
  }
  const left = cfg.trialDays - Math.floor((now - st.first) / DAY);
  if (left > 0) return { ok: true, mode: 'trial', daysLeft: left, modules: [] };
  return { ok: false, mode: 'expired', reason: 'Deneme süresi bitti. Lütfen lisans kodu girin.' };
}

// ---------- aktivasyon penceresi ----------
function showActivation(mode) {
  if (actWin) { actWin.focus(); return; }
  actMode = mode; finished = false;
  const parent = mode === 'change' ? (BrowserWindow.getFocusedWindow() || undefined) : undefined;
  actWin = new BrowserWindow({
    width: 560, height: 650, resizable: false, minimizable: false, title: 'Lisans', parent, modal: !!parent,
    webPreferences: { preload: path.join(__dirname, 'activation-preload.js'), contextIsolation: true, sandbox: true }
  });
  actWin.setMenu(null);
  actWin.loadFile(path.join(__dirname, 'activation.html'));
  actWin.on('closed', () => { actWin = null; if (!finished && actMode === 'gate') app.quit(); });
}
function finish() {
  finished = true;
  const next = () => {
    if (actMode === 'gate' && proceed) { const f = proceed; proceed = null; f(); }
    BrowserWindow.getAllWindows().forEach(paint);
  };
  const w = actWin;
  if (w && !w.isDestroyed()) { w.once('closed', next); w.close(); } else next();
}
function applyText(text) {
  const v = verifyText(text);
  if (!v.ok) return { error: v.reason };
  fs.writeFileSync(udata('license.lic'), String(text).trim());
  finish();
  return { ok: true };
}
function registerIpc() {
  ipcMain.handle('lic:info', () => ({ code: machineCode(), status: status(), product: cfg.product, mode: actMode }));
  ipcMain.handle('lic:apply', (_e, t) => applyText(t));
  ipcMain.handle('lic:pick', async () => {
    const r = await dialog.showOpenDialog(actWin, { filters: [{ name: 'Lisans', extensions: ['lic', 'txt'] }], properties: ['openFile'] });
    return r.canceled ? { cancelled: true } : applyText(fs.readFileSync(r.filePaths[0], 'utf8'));
  });
  ipcMain.handle('lic:trial', () => { if (status().mode !== 'trial') return { error: 'Deneme süresi bitmiş.' }; finish(); return { ok: true }; });
  ipcMain.handle('lic:copy', (_e, t) => { clipboard.writeText(String(t)); });
}

// ---------- firma adı: pencere başlığı + köşe etiketi + Lisans menüsü ----------
function label() {
  const s = status();
  return s.mode === 'licensed' ? 'Lisanslı: ' + s.customer : s.mode === 'trial' ? 'Deneme sürümü — ' + s.daysLeft + ' gün kaldı' : '';
}
function paint(w) {
  if (!w || w.isDestroyed() || w === actWin || w.webContents.isLoading()) return;
  const t = label();
  w.setTitle((w.__base || '') + (t ? ' — ' + t : ''));
  w.webContents.executeJavaScript(`(()=>{let b=document.getElementById('licBadge');if(!b){b=document.createElement('div');b.id='licBadge';
    b.style.cssText='position:fixed;right:10px;bottom:8px;z-index:2147483647;font:600 12px Segoe UI,Arial,sans-serif;background:rgba(15,23,42,.88);color:#fff;padding:3px 10px;border-radius:12px;pointer-events:none';
    document.body.appendChild(b);addEventListener('beforeprint',()=>b.style.display='none');addEventListener('afterprint',()=>b.style.display='block')}
    b.textContent=${JSON.stringify(t)};b.style.display=${JSON.stringify(t)}?'block':'none'})()`).catch(() => {});
}
function showInfo() {
  const s = status();
  const detail = (s.mode === 'licensed' ? 'Firma: ' + s.customer + '\nBitiş: ' + s.expires + ' (' + s.daysLeft + ' gün kaldı)' : 'Deneme sürümü, kalan gün: ' + s.daysLeft)
    + '\nÜrün: ' + cfg.product + '\nMakine kodu: ' + machineCode();
  dialog.showMessageBox(BrowserWindow.getFocusedWindow() || undefined, { type: 'info', title: 'Lisans', message: 'Lisans bilgisi', detail, buttons: ['Tamam', 'Makine kodunu kopyala'] })
    .then(r => { if (r.response === 1) clipboard.writeText(machineCode()); });
}
function addMenu() {
  const m = Menu.getApplicationMenu();
  if (!m || m.getMenuItemById('lic-menu')) return;
  m.append(new MenuItem({ id: 'lic-menu', label: 'Lisans', submenu: [
    { label: 'Lisans bilgisi', click: showInfo },
    { label: 'Lisans kodu gir / yenile…', click: () => showActivation('change') }
  ] }));
  Menu.setApplicationMenu(m);
}
function decorate(w) {
  w.on('page-title-updated', e => { if (w !== actWin) e.preventDefault(); });
  w.webContents.on('did-finish-load', () => {
    if (w === actWin) return;
    if (!w.__base) { w.__base = w.getTitle(); if (!w.__base || w.__base === 'Electron') w.__base = app.getName(); }
    paint(w); addMenu();
  });
}

// ---------- başlatma ----------
function boot(o) {
  cfg = { ...cfg, ...o };
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  const keep = () => {};
  app.on('window-all-closed', keep);                 // aktivasyon penceresi kapanınca uygulama kapanmasın
  app.on('second-instance', () => { if (actWin) actWin.focus(); });
  app.on('browser-window-created', (_e, w) => decorate(w));
  registerIpc();
  app.whenReady().then(() => {
    const start = () => {
      const before = app.listenerCount('ready');
      require(path.join(app.getAppPath(), cfg.main)); // uygulamanın kendi ana dosyası
      app.removeListener('window-all-closed', keep);
      if (app.listenerCount('window-all-closed') === 0) app.on('window-all-closed', () => app.quit());
      if (app.listenerCount('ready') > before) app.emit('ready');
    };
    if (status().mode === 'licensed') start(); else { proceed = start; showActivation('gate'); }
  });
}
module.exports = { boot, status, machineCode };
