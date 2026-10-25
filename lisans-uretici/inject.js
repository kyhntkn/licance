'use strict';
const fs = require('fs'), path = require('path');
const { readZip, writeZip } = require('./zip-lite');
const TPL = path.join(__dirname, 'template');

const workflow = out => `name: Derle
on:
  workflow_dispatch:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npx electron-builder --win --publish never
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: false
          CSC_LINK: \${{ secrets.WIN_CSC_LINK }}
          CSC_KEY_PASSWORD: \${{ secrets.WIN_CSC_KEY_PASSWORD }}
      - uses: actions/upload-artifact@v4
        with:
          name: kurulum
          path: ${out}/*.exe
          if-no-files-found: error
`;

function inject(zipBuf, { product, trialDays, publicKey }) {
  const log = [];
  const entries = readZip(zipBuf).filter(e => !/(^|\/)(__MACOSX\/|\.DS_Store$)/.test(e.name));
  const pk = entries.filter(e => !e.dir && /(^|\/)package\.json$/.test(e.name) && !/node_modules\//.test(e.name))
    .sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0];
  if (!pk) throw new Error('Zip içinde package.json yok. Electron projesinin KAYNAK KOD zip\'ini seçin (derlenmiş kurulum .exe değil).');
  const root = pk.name.slice(0, -'package.json'.length);
  const pkg = JSON.parse(pk.data.toString('utf8').replace(/^\uFEFF/, ''));

  const main = pkg.lisans ? pkg.lisans.main : (pkg.main || 'index.js');
  if (pkg.main === 'lisans-baslat.js' && !pkg.lisans) throw new Error('package.json bozuk görünüyor (lisans ayarı yok).');
  const mainOk = entries.some(e => [root + main, root + main + '.js'].includes(e.name));
  if (!mainOk) log.push('UYARI: ana dosya (' + main + ') zip içinde bulunamadı, lütfen kontrol edin.');
  const again = !!pkg.lisans;
  pkg.lisans = { product, trialDays, main };
  pkg.main = 'lisans-baslat.js';
  pkg.dependencies = { ...(pkg.dependencies || {}), 'node-machine-id': '1.1.12' };
  const all = { ...pkg.dependencies, ...(pkg.devDependencies || {}) };
  pkg.devDependencies = pkg.devDependencies || {};
  if (!all.electron) { pkg.devDependencies.electron = '^33.2.0'; log.push('electron bağımlılığı eklendi.'); }
  if (!all['electron-builder']) { pkg.devDependencies['electron-builder'] = '^25.1.8'; log.push('electron-builder bağımlılığı eklendi.'); }
  // --- Electron Fuses: yalnızca app.asar'dan yükle + asar bütünlük doğrulaması ---
  const major = v => { const m = String(v || '').match(/\d+/); return m ? parseInt(m[0], 10) : 0; };
  const ver = n => (pkg.devDependencies || {})[n] || (pkg.dependencies || {})[n];
  if (pkg.build && pkg.build.asar === false) {
    log.push('UYARI: projede asar kapalı (asar:false), Fuses eklenmedi.');
  } else {
    if (major(ver('electron-builder')) < 26) {
      pkg.devDependencies['electron-builder'] = '^26.0.0';
      log.push('electron-builder, Fuses desteği için ^26.0.0 sürümüne yükseltildi.');
    }
    const integrity = major(ver('electron')) >= 30;
    pkg.build = pkg.build || {};
    pkg.build.electronFuses = { ...(pkg.build.electronFuses || {}), onlyLoadAppFromAsar: true, enableEmbeddedAsarIntegrityValidation: integrity };
    log.push('Fuses: onlyLoadAppFromAsar açık, asar bütünlük doğrulaması ' + (integrity ? 'açık.' : 'KAPALI (Windows için Electron 30+ gerekir).'));
  }
  if (pkg.build && Array.isArray(pkg.build.files))
    for (const f of ['lisans-baslat.js', 'lisans/**/*']) if (!pkg.build.files.includes(f)) pkg.build.files.push(f);

  const put = (rel, data) => {
    const en = { name: root + rel, data: Buffer.from(data) };
    const i = entries.findIndex(e => e.name === en.name);
    if (i >= 0) entries[i] = en; else entries.push(en);
  };
  put('package.json', JSON.stringify(pkg, null, 2) + '\n');
  for (const f of ['license.js', 'activation.html', 'activation-preload.js']) put('lisans/' + f, fs.readFileSync(path.join(TPL, f)));
  put('lisans/public-key.js', 'module.exports = `' + publicKey.trim() + '`;\n');
  put('lisans-baslat.js', "require('./lisans/license').boot(" + JSON.stringify({ product, trialDays, main }) + ");\n");
  log.push(again ? 'Lisans dosyaları güncellendi.' : 'Lisans modülü eklendi, package.json ve başlangıç dosyası ayarlandı.');

  if (!entries.some(e => e.name.startsWith(root + '.github/workflows/'))) {
    put('.github/workflows/build.yml', workflow((pkg.build && pkg.build.directories && pkg.build.directories.output) || 'dist'));
    log.push('GitHub derleme dosyası (.github/workflows/build.yml) eklendi.');
  } else log.push('Mevcut GitHub derleme dosyası korundu.');
  log.push('Ürün adı: ' + product + ' | Deneme: ' + trialDays + ' gün | Ana dosya: ' + main);
  return { buf: writeZip(entries), log };
}
module.exports = { inject };
