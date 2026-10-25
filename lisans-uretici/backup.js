'use strict';
// Yedek dosyası: parola ile AES-256-GCM şifreli (private.pem içerdiği için düz metin değildir)
const crypto = require('crypto');
const KDF = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

function pack(obj, pw) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(pw, salt, 32, KDF), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.from(JSON.stringify({
    app: 'lisans-uretici-yedek', v: 1, salt: salt.toString('base64'), iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'), data: data.toString('base64')
  }));
}

function unpack(buf, pw) {
  let o;
  try { o = JSON.parse(buf.toString('utf8')); if (o.app !== 'lisans-uretici-yedek') throw 0; }
  catch { throw new Error('Bu bir Lisans Üretici yedek dosyası değil.'); }
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(pw, Buffer.from(o.salt, 'base64'), 32, KDF), Buffer.from(o.iv, 'base64'));
    d.setAuthTag(Buffer.from(o.tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(o.data, 'base64')), d.final()]).toString('utf8'));
  } catch { throw new Error('Parola yanlış ya da yedek dosyası bozuk.'); }
}
module.exports = { pack, unpack };
