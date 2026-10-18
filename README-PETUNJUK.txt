LAPOR BERITA — MEDIA PENDIDIKAN INDONESIA
Paket desain ulang awal, responsif untuk HP dan komputer.

FILE UTAMA
- index.html                 Beranda desain nomor 2
- kategori.html              Daftar berita per wilayah/pencarian
- artikel.html               Halaman detail berita
- admin.html + admin.js      Panel admin: login, tulis/edit berita, metadata URL
- laporkan-berita.html       Halaman kirim berita (belum diaktifkan untuk publik)
- style.css                  Desain biru-putih elegan
- supabase-config.js         Konfigurasi publik yang sudah ada di repositori
- upgrade-schema.sql         Tambahan kolom wilayah dan media, tidak menghapus data
- functions/tarik-data-berita/index.ts  Edge Function untuk metadata halaman sumber

PENTING — BACA SEBELUM MENGGANTI
Paket ini menyiapkan desain baru dan alur dasar. Jangan anggap seluruh fitur sudah produksi:
1. Buat backup repository dan database terlebih dahulu.
2. Upload/replace file HTML/CSS/JS yang tercantum ke root repository, jangan menghapus seluruh repository.
3. Jalankan upgrade-schema.sql sekali di Supabase SQL Editor. Ini hanya menambah kolom; tidak menghapus tabel/data.
4. Pastikan fungsi RPC is_site_admin dan kebijakan RLS admin yang sudah dipakai proyek masih aktif. Jangan menonaktifkan RLS.
5. Deploy Edge Function tarik-data-berita dari folder functions/tarik-data-berita. Jika menggunakan dashboard editor di HP, salin index.ts ke Edge Function bernama tarik-data-berita, lalu deploy.
6. Fitur tarik URL mengambil metadata (judul, deskripsi, gambar Open Graph) saja. Banyak situs tidak mengizinkan pengambilan isi artikel penuh; tidak ada jaminan semua sumber bisa ditarik. Selalu periksa dan cantumkan sumber serta hak penggunaan.
7. Pemilihan hingga 10 foto/video pada panel ini masih berupa pemilihan berkas; upload nyata belum diaktifkan. Sebelum mengaktifkan, buat bucket Storage, kebijakan admin, dan alur upload aman. Jangan menerbitkan media yang belum benar-benar tersimpan.
8. Penentuan wilayah otomatis adalah perkiraan berbasis kata kunci, bukan basis data wilayah lengkap. Periksa dan koreksi wilayah sebelum terbit.
9. Halaman kirim berita publik belum tersambung ke database. Sengaja tidak diaktifkan sampai RLS, moderasi, dan penyimpanan aman selesai.
10. Jangan menyimpan service_role key di file frontend. Publishable key boleh berada di frontend; pastikan RLS benar.

URUTAN PALING MUDAH DI HP ANDROID
A. Unduh ZIP ini dan ekstrak.
B. Di GitHub, buka repository > Add file > Upload files, unggah file baru/replace file yang sama di root. Untuk folder functions, unggah lewat editor/fitur GitHub yang mendukung folder atau deploy melalui Supabase.
C. Jalankan upgrade-schema.sql satu kali di Supabase SQL Editor.
D. Deploy Edge Function tarik-data-berita.
E. Tes beranda, login admin, buat satu berita draf, dan cek halaman artikel. Jika ada pesan error, kirim tangkapan layar.

Jangan hapus file schema.sql, konfigurasi, atau tabel Supabase lama. Simpan backup dahulu.
