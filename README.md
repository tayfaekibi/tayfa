# Tayfa

Arkadaş grubu uygulaması: planlar, anılar, sohbet ve oyunlar. Telefonun ana ekranına eklenen bir web uygulaması (PWA).

## Yapı
- `index.html`, `app.js`, `style.css`, `sw.js`: uygulama (GitHub Pages'te yayınlanır)
- `config.js`: herkese açık ayarlar (Supabase adresi ve yayınlanabilir anahtar). Gizli anahtar yoktur.
- `supabase/kurulum.sql`: veritabanı kurulumu (Supabase SQL Editor'de çalıştırılır)
- `supabase/functions/push`: bildirim gönderen Edge Function

## Sürüm 1.0.0
- Davet kodlu kayıt (tek kullanımlık, e-postaya bağlı, 48 saat), yönetici onayı
- KVKK aydınlatma metni ve ayrı açık rıza onayları
- Plan önerme, yönetici onayı, katılım (geliyorum / gelemem)
- Yönetim ekranı: davet, üye ve plan onayları, üye çıkarma
- Bildirimler; onay bekleyen plan için 5 dakika sonra tek hatırlatma
