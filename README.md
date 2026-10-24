# Lisans Üretici v2

Electron projelerinizi (ilaç sipariş, ihracat takip vb.) lisanslar ve müşterilere lisans kodu üretir.

## Kullanım akışı
1. Lisans Üretici'yi açın > "Anahtar üret" (BİR KEZ). private.pem dosyasını yedekleyin.
2. "Projeyi lisansla": projenin KAYNAK KOD zip'ini seçin, ürün adı (örn. ilac-siparis) ve deneme gününü girin,
   "Zip'i lisansla ve kaydet" deyin. Program lisans dosyalarını zip'in içine kendisi yerleştirir.
3. Çıkan zip'i bilgisayarda açın, içindeki dosyaları GitHub'daki ÖZEL repoya yükleyin
   (GitHub web arayüzü zip'i kendisi açmaz; açıp dosyaları sürükleyin, .github klasörü dahil).
4. Actions > Run workflow ile derleyin, Artifacts'tan kurulum exe'sini indirin.
5. Müşteri kurar: açılan pencerede MAKİNE KODU görünür; lisans kodu girer veya "Deneme sürümü ile devam" der.
6. Müşteri makine kodunu gönderir > Lisans Üretici "3) Lisans kodu üret" bölümüne müşteri adı, ürün adı,
   makine kodu, bitiş tarihini girin > çıkan kodu müşteriye gönderin.
7. Müşteri uygulamada "Lisans > Lisans kodu gir / yenile…" menüsünden kodu yapıştırır.

## Notlar
- Ürün adı, zip'i lisanslarken yazdığınızla lisans üretirken yazdığınız AYNI olmalı.
- Lisans tek bilgisayara bağlıdır. Windows yeniden kurulursa makine kodu değişir, yeni lisans gerekir.
- Anahtarı yenilerseniz eski anahtarla lisanslanmış tüm uygulamalar yeniden lisanslanıp derlenmelidir.
- Zip'te node_modules ve dist klasörleri OLMAMALI (sadece kaynak kod).
- Kod imzalama sertifikanız varsa GitHub Secrets: WIN_CSC_LINK (base64 .pfx), WIN_CSC_KEY_PASSWORD.

## Lisans Üretici'yi derleme
Bu klasörü özel bir GitHub reposuna yükleyin > Actions > "Lisans Uretici Derle" > Run workflow.
