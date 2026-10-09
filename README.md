# Lapor Berita — Starter Repository

Portal berita independen berbahasa Indonesia. Frontend multi-halaman untuk GitHub Pages dan rancangan integrasi Supabase.

## Penting
Repositori ini adalah **starter project**, bukan sistem produksi yang sudah terhubung. Sebelum menerima laporan nyata, terutama NIK/foto KTP, konfigurasi Supabase, autentikasi, Storage privat, RLS, dan pengujian keamanan wajib diselesaikan.

## Halaman
- `index.html` — beranda
- `berita.html` — daftar berita
- `artikel.html` — contoh detail artikel (`?slug=...`)
- `kategori.html` — berita per kategori (`?nama=Daerah`)
- `pencarian.html` — pencarian
- `laporkan-berita.html` — formulir laporan (mode demo, tidak mengirim data)
- `tentang.html`, `kontak.html`, `pedoman-media.html`, `kebijakan-privasi.html`, `koreksi-hak-jawab.html`
- `admin/login.html`, `admin/index.html`, `admin/berita.html`, `admin/laporan-masyarakat.html`, `admin/navigasi.html`, `admin/halaman.html`, `admin/pengaturan.html`

## Jalankan lokal
Buka `index.html` di browser, atau jalankan server lokal:
```bash
python -m http.server 8000
```
Lalu buka `http://localhost:8000`.

## Upload ke GitHub Pages
1. Buat repositori baru bernama `lapor-berita`.
2. Ekstrak ZIP ini dan unggah semua isi folder ke root repositori.
3. Buka **Settings → Pages**.
4. Pada **Build and deployment**, pilih **Deploy from a branch**.
5. Pilih branch `main`, folder `/ (root)`, lalu Save.
6. Tunggu proses deployment selesai. URL akan berbentuk `https://USERNAME.github.io/lapor-berita/` (untuk project site). Ini contoh pola URL, bukan alamat yang sudah aktif.

## Supabase (langkah berikutnya)
- Buat proyek Supabase sendiri.
- Jalankan SQL yang direncanakan di `database/schema.sql` setelah ditinjau dan disesuaikan.
- Konfigurasikan Auth, Storage, RLS, dan fungsi server-side sebelum mengaktifkan login atau formulir sungguhan.
- Jangan pernah memasukkan `service_role` key ke file frontend. Kunci anon/publishable pun hanya aman bila RLS sudah benar.
- Untuk NIK dan foto KTP, gunakan tabel dan bucket privat, akses minimum, kebijakan retensi, dan signed URL singkat. Pertimbangkan apakah pengumpulan KTP benar-benar diperlukan.

## Status fitur
- Desain responsif dan navigasi: prototipe frontend.
- Artikel contoh: data demo di `assets/js/app.js`.
- Form laporan: demonstrasi UI saja, tidak menyimpan atau mengirim data.
- Login admin: halaman UI saja, belum autentikasi nyata.
- CRUD, repost, approval, penyimpanan foto, dan pengaturan dinamis: belum aktif sebelum backend diimplementasikan dan diuji.
