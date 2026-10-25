const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const { inject } = require('./inject');
const { pack, unpack } = require('./backup');

const keyDir = () => path.join(app.getPath('userData'), 'keys');
const privP = () => path.join(keyDir(), 'private.pem');
const pubP = () => path.join(keyDir(), 'public.pem');
const logP = () => path.join(app.getPath('userData'), 'verilen-lisanslar.json');
const prodP = () => path.join(app.getPath('userData'), 'urunler.json');
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };

ipcMain.handle('keys', () => ({ exists: fs.existsSync(privP()), dir: keyDir() }));

ipcMain.handle('gen', async () => {
  if (!fs.existsSync(privP())) {
    const r = await dialog.showMessageBox({
      type: 'question', buttons: ['Vazgeç', 'Yeni anahtar üret'], defaultId: 0, message: 'Yeni anahtar üretilsin mi?',
      detail: 'Daha önce başka bir bilgisayarda anahtar ürettiyseniz VAZGEÇİN ve "Yedekten geri yükle" düğmesini kullanın. Yeni anahtar üretirseniz eski lisanslar çalışmaz.'
    });
    if (r.response !== 1) return { cancelled: true };
  }
  if (fs.existsSync(privP())) {
    const r = await dialog.showMessageBox({
      type: 'warning', buttons: ['Vazgeç', 'Yeni anahtar üret'], defaultId: 0, message: 'Mevcut anahtar silinecek!',
      detail: 'Eski anahtarla lisanslanmış TÜM uygulamalar ve verilmiş lisanslar geçersiz olur. Uygulamaları yeniden lisanslayıp derlemeniz gerekir.'
    });
    if (r.response !== 1) return { cancelled: true };
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(keyDir(), { recursive: true });
  fs.writeFileSync(privP(), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(pubP(), publicKey.export({ type: 'spki', format: 'pem' }));
  return { ok: true };
});

ipcMain.handle('pickZip', async () => {
  const r = await dialog.showOpenDialog({ filters: [{ name: 'Proje zip', extensions: ['zip'] }], properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
});

// Zip'i lisansla: lisans modülünü ve ayarları zip'in içine yerleştirir
ipcMain.handle('inject', async (_e, d) => {
  if (!fs.existsSync(pubP())) return { error: 'Önce anahtar üretin.' };
  if (!d.zipPath) return { error: 'Zip dosyası seçin.' };
  const product = (d.product || '').trim();
  if (!/^[\w-]+$/.test(product)) return { error: 'Ürün adı sadece harf, rakam, tire ve alt çizgi içermeli (örn. ilac-siparis).' };
  const trialDays = Math.max(0, Math.min(365, parseInt(d.trialDays, 10) || 14));
  let res;
  try { res = inject(fs.readFileSync(d.zipPath), { product, trialDays, publicKey: fs.readFileSync(pubP(), 'utf8') }); }
  catch (e) { return { error: e.message }; }
  const r = await dialog.showSaveDialog({ defaultPath: path.basename(d.zipPath, '.zip') + '-lisansli.zip', filters: [{ name: 'Zip', extensions: ['zip'] }] });
  if (r.canceled) return { cancelled: true };
  fs.writeFileSync(r.filePath, res.buf);
  const list = readJson(prodP(), []).filter(x => x !== product); list.unshift(product);
  fs.writeFileSync(prodP(), JSON.stringify(list));
  return { ok: true, path: r.filePath, log: res.log };
});

ipcMain.handle('products', () => readJson(prodP(), []));

// Lisans kodu üret
ipcMain.handle('create', (_e, d) => {
  if (!fs.existsSync(privP())) return { error: 'Önce anahtar üretin.' };
  const machine = (d.machine || '').replace(/[\s-]/g, '').toUpperCase();
  if (!d.customer || !d.product || !d.expires) return { error: 'Müşteri adı, ürün adı ve bitiş tarihi zorunlu.' };
  if (!/^[0-9A-F]{20}$/.test(machine)) return { error: 'Makine kodu zorunlu ve 20 karakter olmalı (örn. A1B2C-D3E4F-A1B2C-D3E4F).' };
  const payload = JSON.stringify({
    v: 1, customer: d.customer.trim(), product: d.product.trim(), machine,
    issued: new Date().toISOString().slice(0, 10), expires: d.expires,
    modules: (d.modules || '').split(',').map(s => s.trim()).filter(Boolean)
  });
  const priv = crypto.createPrivateKey(fs.readFileSync(privP()));
  const sig = crypto.sign(null, Buffer.from(payload), priv).toString('base64');
  const code = 'LIC1.' + Buffer.from(JSON.stringify({ payload, sig })).toString('base64');
  const log = readJson(logP(), []); log.unshift(JSON.parse(payload));
  fs.writeFileSync(logP(), JSON.stringify(log, null, 1));
  return { ok: true, code };
});

ipcMain.handle('saveLic', async (_e, d) => {
  const r = await dialog.showSaveDialog({ defaultPath: (d.name || 'lisans').replace(/[^\w-]+/g, '_') + '.lic' });
  if (r.canceled) return { cancelled: true };
  fs.writeFileSync(r.filePath, d.code); return { ok: true, path: r.filePath };
});
const pubOf = pem => crypto.createPublicKey(crypto.createPrivateKey(pem)).export({ type: 'spki', format: 'pem' });
const uniq = (a, b) => { const seen = new Set(); return [...a, ...b].filter(x => { const s = JSON.stringify(x); if (seen.has(s)) return false; seen.add(s); return true; }); };

// Başka bilgisayara taşıma: anahtar + lisans listesi + ürün listesi tek şifreli dosyada
ipcMain.handle('backup', async (_e, pw) => {
  if (!fs.existsSync(privP())) return { error: 'Yedeklenecek anahtar yok.' };
  if (!pw || pw.length < 8) return { error: 'Yedek parolası en az 8 karakter olmalı.' };
  const day = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog({ defaultPath: 'lisans-uretici-yedek-' + day + '.lisansyedek', filters: [{ name: 'Lisans yedeği', extensions: ['lisansyedek'] }] });
  if (r.canceled) return { cancelled: true };
  fs.writeFileSync(r.filePath, pack({
    private: fs.readFileSync(privP(), 'utf8'), public: fs.readFileSync(pubP(), 'utf8'),
    log: readJson(logP(), []), products: readJson(prodP(), []), date: day
  }, pw));
  return { ok: true, path: r.filePath };
});

ipcMain.handle('restore', async (_e, pw) => {
  if (!pw) return { error: 'Yedek parolasını girin.' };
  const r = await dialog.showOpenDialog({ filters: [{ name: 'Lisans yedeği', extensions: ['lisansyedek'] }], properties: ['openFile'] });
  if (r.canceled) return { cancelled: true };
  let o, pub;
  try { o = unpack(fs.readFileSync(r.filePaths[0]), pw); pub = pubOf(o.private); } catch (e) { return { error: e.message || 'Yedek geçersiz.' }; }
  let same = false;
  if (fs.existsSync(privP())) {
    try { same = pubOf(fs.readFileSync(privP(), 'utf8')) === pub; } catch {}
    if (!same) {
      const c = await dialog.showMessageBox({ type: 'warning', buttons: ['Vazgeç', 'Üzerine yaz'], defaultId: 0, message: 'Bu bilgisayardaki anahtar yedektekinden FARKLI.',
        detail: 'Üzerine yazarsanız bu bilgisayardaki anahtarla verilmiş lisanslar geçersiz olur.' });
      if (c.response !== 1) return { cancelled: true };
    }
  }
  fs.mkdirSync(keyDir(), { recursive: true });
  fs.writeFileSync(privP(), o.private, { mode: 0o600 });
  fs.writeFileSync(pubP(), pub);
  fs.writeFileSync(logP(), JSON.stringify(same ? uniq(readJson(logP(), []), o.log || []) : (o.log || []), null, 1));
  fs.writeFileSync(prodP(), JSON.stringify(same ? uniq(readJson(prodP(), []), o.products || []) : (o.products || [])));
  return { ok: true, date: o.date, lic: (o.log || []).length, products: (o.products || []).length };
});

ipcMain.handle('copy', (_e, t) => { clipboard.writeText(String(t)); });
ipcMain.handle('log', () => readJson(logP(), []));

app.whenReady().then(() => {
  const w = new BrowserWindow({
    width: 800, height: 900, autoHideMenuBar: true, title: 'Lisans Üretici', icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  w.loadFile('index.html');
});
app.on('window-all-closed', () => app.quit());
