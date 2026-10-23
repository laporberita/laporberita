(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const cfg = window.LAPOR_BERITA_CONFIG;
  const REGION_API = 'https://www.emsifa.com/api-wilayah-indonesia/v2';
  // Bucket publik khusus media berita. Bucket laporan-bukti tetap privat.
  const NEWS_MEDIA_BUCKET = 'berita-media';
  const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=700&q=75';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  const date = value => {
    if (!value) return '-';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('id-ID', {
      dateStyle: 'medium', timeStyle: 'short'
    });
  };

  const slugify = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150);

  function validUrl(value) {
    if (!value) return null;
    let url;
    try { url = new URL(value); }
    catch (_) { throw new Error('Tautan tidak valid. Awali dengan https:// atau http://.'); }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Tautan harus menggunakan HTTP atau HTTPS.');
    }
    return url.href;
  }

  function isMissingColumn(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '').toLowerCase();
    return code === '42703' || code === 'PGRST204' ||
      (message.includes('column') && (message.includes('does not exist') || message.includes('schema cache')));
  }

  let db = null;
  let currentUser = null;
  let articles = [];
  let reports = [];
  let activeReport = null;
  let actionRunning = false;
  let refreshing = false;
  let regionListsReady = false;
  let mediaPreviewUrls = [];
  let imagePreviewUrl = null;
  let locationWarning = '';
  let provinceCache = [];

  function message(id, text, isError = false) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? '#b42318' : '';
  }

  function showLogin() {
    $('login-panel')?.classList.remove('hidden');
    $('admin-panel')?.classList.add('hidden');
  }

  function showAdmin() {
    $('login-panel')?.classList.add('hidden');
    $('admin-panel')?.classList.remove('hidden');
  }

  function setActionBusy(value) {
    actionRunning = value;
    ['login-btn', 'save-btn', 'publish-btn', 'fetch-btn', 'cancel-btn', 'logout-btn'].forEach(id => {
      const el = $(id);
      if (el) el.disabled = value;
    });
    const refresh = $('refresh-btn');
    if (refresh) refresh.disabled = value || refreshing;
  }

  function checkConfig() {
    if (!cfg?.SUPABASE_URL || !cfg?.SUPABASE_PUBLISHABLE_KEY) {
      throw new Error('Konfigurasi Supabase belum lengkap. Periksa supabase-config.js.');
    }
    if (!window.supabase?.createClient) {
      throw new Error('Pustaka Supabase belum termuat. Periksa koneksi internet.');
    }
    db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }

  async function verifyAdmin() {
    if (!db) throw new Error('Supabase belum tersambung.');
    const result = await db.auth.getUser();
    if (result.error || !result.data?.user) {
      currentUser = null;
      return false;
    }
    currentUser = result.data.user;
    const adminResult = await db.rpc('is_site_admin');
    if (adminResult.error) {
      console.error('Pemeriksaan hak admin gagal:', adminResult.error);
      throw new Error('Hak admin belum dapat diverifikasi. Periksa fungsi is_site_admin() dan izin Supabase.');
    }
    if (adminResult.data !== true) {
      await db.auth.signOut();
      currentUser = null;
      throw new Error('Akun ini belum diberi hak admin LAPOR BERITA.');
    }
    return true;
  }

  async function login(event) {
    event.preventDefault();
    if (actionRunning) return;
    if (!db) {
      message('login-message', 'Supabase belum siap. Muat ulang halaman dan periksa koneksi.', true);
      return;
    }
    const email = $('email')?.value.trim() || '';
    const password = $('password')?.value || '';
    if (!email || !password) {
      message('login-message', 'Email dan kata sandi wajib diisi.', true);
      return;
    }
    setActionBusy(true);
    message('login-message', 'Memeriksa akun admin…');
    try {
      const signedIn = await db.auth.signInWithPassword({ email, password });
      if (signedIn.error) throw signedIn.error;
      const authorized = await verifyAdmin();
      if (!authorized) throw new Error('Sesi login tidak ditemukan.');
      showAdmin();
      if ($('session-info')) $('session-info').textContent = 'Login sebagai ' + (currentUser?.email || 'Admin');
      await refreshAll();
      message('login-message', 'Login berhasil.');
    } catch (error) {
      console.error('Login admin gagal:', error);
      message('login-message', error.message || 'Login gagal. Periksa akun dan konfigurasi.', true);
      showLogin();
    } finally {
      setActionBusy(false);
    }
  }

  async function logout() {
    if (!db || actionRunning) return;
    setActionBusy(true);
    try {
      const { error } = await db.auth.signOut();
      if (error) throw error;
      currentUser = null;
      showLogin();
      message('login-message', 'Anda telah keluar dari panel admin.');
    } catch (error) {
      message('login-message', 'Gagal keluar: ' + error.message, true);
    } finally {
      setActionBusy(false);
    }
  }

  async function getArticles() {
    const extended = 'id,title,slug,summary,body,category_id,image_path,author_label,source_url,status,published_at,created_at,updated_at,district,village,location_manual,location_detail,region_type,province,regency,city,media_urls';
    const first = await db.from('articles').select(extended).order('created_at', { ascending: false }).limit(200);
    if (!first.error) return { data: first.data || [], usedFallback: false };
    if (!isMissingColumn(first.error)) throw first.error;
    const core = await db.from('articles')
      .select('id,title,slug,summary,body,category_id,image_path,author_label,source_url,status,published_at,created_at,updated_at')
      .order('created_at', { ascending: false }).limit(200);
    if (core.error) throw core.error;
    return { data: core.data || [], usedFallback: true };
  }

  async function getReports() {
    // Dipanggil dari refreshAll() setelah hak admin diverifikasi.
    // select('*') dipakai agar kolom foto yang sudah ada di skema lama/baru
    // tetap terbaca, tanpa mengasumsikan nama kolom tertentu.
    const result = await db.from('public_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (result.error) throw result.error;

    return (result.data || []).map(report => {
      const reportMedia = readReportMedia(report, 'evidence');
      const identityMedia = readReportMedia(report, 'identity');
      return Object.assign({}, report, {
        evidence_path: reportMedia[0]?.value || report.evidence_path || null,
        __laporBeritaEvidenceMedia: reportMedia,
        __laporBeritaIdentityMedia: identityMedia
      });
    });
  }

  const REPORT_EVIDENCE_FIELDS = [
    'evidence_path', 'evidence_url', 'evidence_paths', 'evidence_urls', 'evidence',
    'evidence_file', 'evidence_files', 'evidence_image', 'evidence_image_path', 'evidence_image_url',
    'proof_path', 'proof_url', 'proof_photo_path', 'proof_photo_url',
    'report_photo_path', 'report_photo_url', 'report_photo', 'report_image_path', 'report_image_url',
    'report_media_path', 'report_media_url', 'report_media',
    'news_photo_path', 'news_photo_url', 'news_photo', 'news_image_path', 'news_image_url',
    'photo_path', 'photo_url', 'photo_paths', 'photo_urls', 'photo',
    'image_path', 'image_url', 'image_paths', 'image_urls', 'image',
    'source_image_path', 'source_image_url', 'documentation_path', 'documentation_url',
    'attachment_path', 'attachment_url', 'attachment', 'attachments',
    'document_path', 'document_url', 'upload_path', 'upload_url', 'uploaded_file_path', 'uploaded_file_url',
    'media_path', 'media_url', 'media_urls', 'media', 'media_files', 'report_files', 'photos', 'images', 'files'
  ];

  const REPORT_IDENTITY_FIELDS = [
    'ktp_path', 'ktp_url', 'ktp_photo_path', 'ktp_photo_url',
    'ktp_image_path', 'ktp_image_url', 'ktp_image', 'foto_ktp_path', 'foto_ktp_url',
    'identity_photo_path', 'identity_photo_url', 'identity_image_path', 'identity_image_url',
    'identity_path', 'identity_url', 'id_card_path', 'id_card_url', 'id_card_image_path', 'id_card_image_url',
    'id_card_photo_path', 'id_card_photo_url', 'id_card_photo', 'reporter_ktp_path', 'reporter_ktp_url',
    'reporter_identity_path', 'identity_document_path', 'identity_document_url', 'identity_document',
    'ktp_file_path', 'ktp_file_url', 'ktp_photo', 'foto_ktp'
  ];

  function mediaValues(value) {
    if (value == null || value === '') return [];
    if (Array.isArray(value)) return value.flatMap(mediaValues);
    if (typeof value === 'object') {
      const candidate = value.path || value.fullPath || value.full_path ||
        value.url || value.publicUrl || value.public_url || value.signedUrl || value.signed_url;
      return candidate ? mediaValues(candidate) : [];
    }
    if (typeof value !== 'string') return [];
    const textValue = value.trim();
    if (!textValue) return [];
    if ((textValue.startsWith('[') && textValue.endsWith(']')) ||
        (textValue.startsWith('{') && textValue.endsWith('}'))) {
      try {
        const parsed = JSON.parse(textValue);
        if (parsed !== value) return mediaValues(parsed);
      } catch (_) {
        // Bukan JSON; perlakukan sebagai satu URL/jalur berkas.
      }
    }
    return [textValue];
  }

  function readReportMedia(report, kind) {
    if (!report || typeof report !== 'object') return [];
    const fields = kind === 'identity' ? REPORT_IDENTITY_FIELDS : REPORT_EVIDENCE_FIELDS;
    const output = [];
    const seen = new Set();

    fields.forEach(field => {
      if (!(field in report)) return;
      mediaValues(report[field]).forEach(value => {
        const key = String(value).trim();
        if (!key || seen.has(key)) return;
        seen.add(key);
        output.push({ field, value: key, kind, reportId: report.id || null });
      });
    });
    return output;
  }

  function decodeStoragePath(path) {
    return String(path || '').split('/').map(part => {
      try { return decodeURIComponent(part); }
      catch (_) { return part; }
    }).join('/');
  }

  function parseReportStorageReference(value, defaultBucket = 'laporan-bukti') {
    const raw = String(value || '').trim();
    if (!raw) throw new Error('Jalur foto kosong.');

    let bucket = defaultBucket;
    let path = raw;
    let directUrl = null;
    const projectOrigin = (() => {
      try { return new URL(cfg.SUPABASE_URL).origin; }
      catch (_) { return ''; }
    })();

    if (/^https?:\/\//i.test(raw)) {
      let parsed;
      try { parsed = new URL(raw); }
      catch (_) { throw new Error('Tautan foto tidak valid.'); }

      if (parsed.origin !== projectOrigin) {
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new Error('Protokol tautan foto tidak aman.');
        }
        return { directUrl: parsed.href, bucket: null, path: null };
      }

      const match = parsed.pathname.match(
        /\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/i
      );
      if (match) {
        bucket = decodeURIComponent(match[1]);
        path = match[2];
      } else {
        throw new Error('URL Supabase tidak memiliki jalur berkas Storage yang dikenali.');
      }
    } else {
      path = path.replace(/^\/+/, '');
      const match = path.match(
        /^(?:(?:storage\/v1\/)?(?:object|render\/image)\/)?(?:public|sign|authenticated)\/([^/]+)\/(.+)$/i
      );
      if (match) {
        bucket = match[1];
        path = match[2];
      } else {
        const bucketMatch = path.match(/^(laporan-bukti|berita-media)\/(.+)$/i);
        if (bucketMatch) {
          bucket = bucketMatch[1];
          path = bucketMatch[2];
        }
      }
    }

    path = decodeStoragePath(path.split('?')[0]);
    if (!path || path.split('/').some(part => part === '..')) {
      throw new Error('Jalur foto tidak valid.');
    }

    // Foto identitas tidak boleh ditarik dari bucket berita yang bersifat publik.
    if (bucket.toLowerCase() === 'berita-media') {
      return { directUrl: db.storage.from('berita-media').getPublicUrl(path).data?.publicUrl || null,
        bucket: 'berita-media', path };
    }

    // Semua jalur tanpa bucket eksplisit dianggap sebagai objek privat laporan.
    return { directUrl: null, bucket, path };
  }

  async function getReportMediaUrl(item, isIdentity) {
    const ref = parseReportStorageReference(item.value, 'laporan-bukti');

    if (isIdentity && ref.bucket !== 'laporan-bukti') {
      throw new Error('Foto KTP harus berada di bucket privat "laporan-bukti". Periksa penyimpanannya demi keamanan data pelapor.');
    }

    if (ref.directUrl) {
      if (isIdentity) {
        throw new Error('Foto KTP ditemukan sebagai tautan eksternal. Untuk menjaga privasi, simpan di bucket privat laporan-bukti.');
      }
      return ref.directUrl;
    }

    if (!ref.path || !ref.bucket) throw new Error('Jalur foto tidak lengkap.');
    if (ref.bucket !== 'laporan-bukti' && ref.bucket !== 'berita-media') {
      throw new Error('Bucket foto tidak dikenal: ' + ref.bucket + '.');
    }

    if (ref.bucket === 'berita-media') {
      return db.storage.from(ref.bucket).getPublicUrl(ref.path).data?.publicUrl || null;
    }

    // Bucket laporan-bukti bersifat privat. Minta Edge Function membuat
    // signed URL dengan service role di server setelah memeriksa sesi admin.
    // Jangan membuat signed URL dari browser: kebijakan Storage untuk user
    // biasa sering menolak SELECT dan menghasilkan pesan menyesatkan
    // "Object not found" meskipun berkas ada.
    const { data, error } = await db.functions.invoke('kirim-laporan-berita', {
      body: {
        action: 'admin_signed_evidence_url',
        report_id: String(item.reportId || ''),
        path: item.value,
        field: item.field || '',
        kind: isIdentity ? 'identity' : 'evidence'
      }
    });

    if (error) {
      let detail = error.message || 'Edge Function gagal membuat tautan foto.';
      try {
        if (error.context && typeof error.context.json === 'function') {
          const body = await error.context.json();
          detail = body?.message || body?.error || detail;
        }
      } catch (_) {}
      throw new Error(detail);
    }
    if (!data || data.success !== true || !data.signed_url) {
      throw new Error(data?.message || 'Supabase belum berhasil membuat tautan foto privat.');
    }
    return data.signed_url;
  }

  async function renderReportMediaGroup(container, items, heading, isIdentity = false) {
    if (!container || !items.length) return false;

    const section = document.createElement('section');
    section.style.cssText = 'margin:14px 0;padding:12px;border:1px solid #d9e2ec;border-radius:10px;';
    const title = document.createElement('h4');
    title.textContent = heading;
    title.style.cssText = 'margin:0 0 10px;';
    section.appendChild(title);

    for (const item of items) {
      const itemBox = document.createElement('div');
      itemBox.style.cssText = 'margin:10px 0;padding-top:8px;border-top:1px solid #edf2f7;';
      const fieldLabel = document.createElement('p');
      fieldLabel.className = 'muted';
      fieldLabel.textContent = 'Berkas: ' + item.field;
      itemBox.appendChild(fieldLabel);

      try {
        const url = await getReportMediaUrl(item, isIdentity);
        if (!url) throw new Error('URL foto tidak berhasil dibuat.');
        const pathname = (() => { try { return new URL(url).pathname; } catch (_) { return item.value; } })().toLowerCase();
        const isVideo = /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(pathname);
        const media = document.createElement(isVideo ? 'video' : 'img');
        media.src = url;
        media.style.cssText = 'display:block;max-width:100%;max-height:560px;height:auto;margin:8px 0;border-radius:8px;background:#f3f6f9;';
        if (isVideo) {
          media.controls = true;
          media.preload = 'metadata';
        } else {
          media.alt = isIdentity ? 'Foto KTP pelapor — hanya untuk verifikasi internal' : 'Foto bukti laporan masyarakat';
          media.loading = 'eager';
        }
        media.addEventListener('error', () => {
          const warning = document.createElement('p');
          warning.className = 'status';
          warning.textContent = 'Berkas ditemukan, tetapi tidak dapat ditampilkan. Periksa apakah file masih ada di Storage dan jenis berkasnya benar.';
          itemBox.appendChild(warning);
        }, { once: true });
        itemBox.appendChild(media);

        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = isIdentity
          ? 'Buka foto identitas untuk verifikasi (tautan privat berlaku 5 menit)'
          : 'Buka foto/video di tab baru' + (item.value.startsWith('http') ? '' : ' (tautan privat berlaku 5 menit)');
        itemBox.appendChild(link);
      } catch (error) {
        const warning = document.createElement('p');
        warning.className = 'status';
        warning.textContent = 'Foto tidak dapat dibuka: ' + (error?.message || 'kesalahan akses');
        itemBox.appendChild(warning);
        console.error('Gagal memuat media laporan (' + item.field + '):', error);
      }

      section.appendChild(itemBox);
    }

    container.appendChild(section);
    return true;
  }

  async function refreshAll() {
    if (!db || !currentUser || refreshing) return;
    refreshing = true;
    const refresh = $('refresh-btn');
    if (refresh) refresh.disabled = true;
    message('article-message', 'Memuat daftar berita…');
    message('report-message', 'Memuat laporan masyarakat…');
    try {
      const authorized = await verifyAdmin();
      if (!authorized) {
        showLogin();
        message('login-message', 'Sesi admin berakhir. Silakan login kembali.', true);
        return;
      }
      const results = await Promise.allSettled([getArticles(), getReports()]);
      if (results[0].status === 'fulfilled') {
        articles = results[0].value.data;
        renderArticles();
        const fallback = results[0].value.usedFallback;
        message('article-message', 'Daftar berita berhasil dimuat: ' + articles.length + (fallback ? '. Sebagian kolom lokasi belum tersedia di database.' : '.'));
      } else {
        console.error('Gagal memuat berita:', results[0].reason);
        articles = [];
        renderArticles();
        message('article-message', 'Gagal memuat berita: ' + (results[0].reason?.message || 'kesalahan database'), true);
      }
      if (results[1].status === 'fulfilled') {
        reports = results[1].value;
        renderReports();
        message('report-message', 'Laporan berhasil dimuat: ' + reports.length + '.');
      } else {
        console.error('Gagal memuat laporan:', results[1].reason);
        reports = [];
        renderReports();
        message('report-message', 'Gagal memuat laporan: ' + (results[1].reason?.message || 'kesalahan database'), true);
      }
    } catch (error) {
      console.error('Pemeriksaan sesi/pemuatan panel gagal:', error);
      message('article-message', 'Panel belum dapat dimuat: ' + error.message, true);
      message('report-message', 'Panel belum dapat dimuat: ' + error.message, true);
    } finally {
      refreshing = false;
      if (refresh) refresh.disabled = actionRunning;
    }
  }

  function renderArticles() {
    const tbody = $('article-list');
    if (!tbody) return;
    if (!articles.length) {
      tbody.innerHTML = '<tr><td colspan="5">Belum ada berita yang dapat ditampilkan.</td></tr>';
      return;
    }
    tbody.innerHTML = articles.map(article => {
      const location = [article.village, article.district, article.regency, article.city, article.province, article.location_manual]
        .filter(Boolean).filter((value, index, arr) => arr.indexOf(value) === index).join(', ');
      const statusLabel = article.status === 'published' ? 'TERBIT / PUBLIK' : (article.status || 'draft');
      const publicLink = article.status === 'published'
        ? '<a class="button secondary" href="artikel.html?id=' + encodeURIComponent(article.id) + '" target="_blank" rel="noopener">Lihat Publik</a>' : '';
      return '<tr>' +
        '<td>' + esc(article.title || '(Tanpa judul)') + '</td>' +
        '<td>' + esc(location || '-') + '</td>' +
        '<td>' + esc(statusLabel) + '</td>' +
        '<td>' + esc(date(article.created_at)) + '</td>' +
        '<td><div class="article-actions">' +
          '<button type="button" class="button secondary" data-edit-article="' + esc(article.id) + '">Edit / Tinjau</button>' +
          '<button type="button" class="button" data-set-article-status="review" data-article-id="' + esc(article.id) + '">Tinjau</button>' +
          '<button type="button" class="button secondary" data-set-article-status="draft" data-article-id="' + esc(article.id) + '">Jadikan Draf</button>' +
          '<button type="button" class="button" data-set-article-status="published" data-article-id="' + esc(article.id) + '">Terbitkan</button>' +
          publicLink +
          '<button type="button" class="button danger" data-delete-article="' + esc(article.id) + '">Hapus</button>' +
        '</div></td></tr>';
    }).join('');
  }

  function renderReports() {
    const tbody = $('report-list');
    if (!tbody) return;
    if (!reports.length) {
      tbody.innerHTML = '<tr><td colspan="4">Belum ada laporan masyarakat.</td></tr>';
      return;
    }
    tbody.innerHTML = reports.map(report =>
      '<tr><td>' + esc(report.title || '(Tanpa judul)') + '</td>' +
      '<td>' + esc(report.status || 'submitted') + '</td>' +
      '<td>' + esc(date(report.created_at)) + '</td>' +
      '<td><div class="report-actions">' +
        '<button type="button" class="button secondary" data-view-report="' + esc(report.id) + '">Tinjau</button>' +
        '<button type="button" class="button" data-use-report="' + esc(report.id) + '">Jadikan Draf</button>' +
        '<button type="button" class="button" data-publish-report="' + esc(report.id) + '">Terbitkan Berita</button>' +
        '<button type="button" class="button danger" data-delete-report="' + esc(report.id) + '">Hapus Permanen</button>' +
      '</div></td></tr>'
    ).join('');
  }

  function clearMediaPreviewUrls() {
    mediaPreviewUrls.forEach(url => URL.revokeObjectURL(url));
    mediaPreviewUrls = [];
  }

  function clearMainImagePreviewUrl() {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    imagePreviewUrl = null;
  }

  function clearLocationChildren() {
    setOptions($('regency-select'), [], 'Pilih provinsi dahulu');
    setOptions($('district-select'), [], 'Pilih kabupaten/kota dahulu');
    setOptions($('village-select'), [], 'Pilih kecamatan dahulu');
  }

  function resetForm() {
    $('article-form')?.reset();
    if ($('article-id')) $('article-id').value = '';
    if ($('source-report-id')) $('source-report-id').value = '';
    if ($('form-title')) $('form-title').textContent = 'Buat Berita';
    if ($('status')) $('status').value = 'draft';
    clearMediaPreviewUrls();
    clearMainImagePreviewUrl();
    if ($('media-preview')) $('media-preview').replaceChildren();
    if ($('image-preview')) $('image-preview').replaceChildren();
    setOptions($('province-select'), provinceCache, 'Pilih provinsi');
    clearLocationChildren();
    if ($('regency-select')) $('regency-select').disabled = true;
    if ($('district-select')) $('district-select').disabled = true;
    if ($('village-select')) $('village-select').disabled = true;
    updateRegionDisplay();
    message('article-message', 'Form dikosongkan.');
  }

  function parseMediaUrls(value) {
    if (Array.isArray(value)) return value.filter(item => typeof item === 'string' && item.trim());
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.filter(item => typeof item === 'string' && item.trim());
      } catch (_) {
        // Support old rows where a single URL was stored as text.
        if (/^https?:\/\//i.test(value.trim())) return [value.trim()];
      }
    }
    return [];
  }

  function renderSavedMedia(urls) {
    const preview = $('media-preview');
    if (!preview) return;
    preview.replaceChildren();
    urls.forEach((url, index) => {
      let safeUrl;
      try { safeUrl = validUrl(url); } catch (_) { return; }
      const item = document.createElement('div');
      item.style.margin = '8px 0';
      if (/\.(mp4|webm)(?:[?#]|$)/i.test(safeUrl)) {
        const video = document.createElement('video');
        video.src = safeUrl; video.controls = true; video.preload = 'metadata';
        video.style.maxWidth = '220px'; video.style.maxHeight = '180px';
        item.appendChild(video);
      } else {
        const img = document.createElement('img');
        img.src = safeUrl; img.alt = 'Media berita tersimpan ' + (index + 1);
        img.style.maxWidth = '220px'; img.style.maxHeight = '180px';
        item.appendChild(img);
      }
      const link = document.createElement('a');
      link.href = safeUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = 'Buka media tersimpan ' + (index + 1);
      item.appendChild(link); preview.appendChild(item);
    });
    if (urls.length) {
      const note = document.createElement('p');
      note.className = 'muted';
      note.textContent = 'Media tersimpan: ' + urls.length + '. Berkas baru yang dipilih akan ditambahkan saat berita disimpan.';
      preview.appendChild(note);
    }
  }

  async function uploadMainImage(file, articleId, existingImageUrl) {
    if (!file) return existingImageUrl || null;
    if (!file.type.startsWith('image/')) {
      throw new Error('Foto utama harus berupa berkas gambar.');
    }
    if (file.size > 20 * 1024 * 1024) {
      throw new Error('Ukuran foto utama maksimal 20 MB.');
    }
    const cleanName = file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-90) || 'foto-utama';
    const safeId = String(articleId || 'berita-' + Date.now()).replace(/[^a-zA-Z0-9_-]+/g, '-');
    const path = 'foto-utama/' + safeId + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 9) + '-' + cleanName;
    const upload = await db.storage.from(NEWS_MEDIA_BUCKET).upload(path, file, {
      cacheControl: '3600', upsert: false, contentType: file.type || undefined
    });
    if (upload.error) {
      const msg = upload.error.message || 'unggahan gagal';
      if (/bucket not found/i.test(msg)) {
        throw new Error('Bucket Storage "' + NEWS_MEDIA_BUCKET + '" belum ada. Pastikan bucket berita-media sudah dibuat dan berstatus Public.');
      }
      throw new Error('Gagal mengunggah foto utama: ' + msg + '. Pastikan kebijakan INSERT Storage untuk admin sudah benar.');
    }
    const publicResult = db.storage.from(NEWS_MEDIA_BUCKET).getPublicUrl(path);
    const publicUrl = publicResult?.data?.publicUrl;
    if (!publicUrl) throw new Error('Foto utama terunggah, tetapi URL publik tidak berhasil dibuat. Periksa bucket berita-media.');
    return publicUrl;
  }

  async function uploadSelectedMedia(articleId, existingUrls) {
    const input = $('media-files');
    const files = Array.from(input?.files || []).slice(0, 10);
    if (!files.length) return existingUrls;
    const accepted = files.filter(file =>
      file.type.startsWith('image/') || ['video/mp4', 'video/webm'].includes(file.type)
    );
    if (accepted.length !== files.length) throw new Error('Gunakan foto atau video MP4/WEBM saja.');
    for (const file of accepted) {
      if (file.size > 20 * 1024 * 1024) throw new Error('Ukuran setiap berkas maksimal 20 MB: ' + file.name);
    }
    const uploadedUrls = [];
    for (const file of accepted) {
      const cleanName = file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-90) || 'media';
      const path = (articleId || 'draft-' + Date.now()) + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 9) + '-' + cleanName;
      const upload = await db.storage.from(NEWS_MEDIA_BUCKET).upload(path, file, {
        cacheControl: '3600', upsert: false, contentType: file.type || undefined
      });
      if (upload.error) {
        const msg = upload.error.message || 'unggahan gagal';
        if (/bucket not found/i.test(msg)) {
          throw new Error('Bucket Storage "' + NEWS_MEDIA_BUCKET + '" belum ada. Buat bucket bernama berita-media dan set Public, lalu coba simpan lagi.');
        }
        throw new Error('Gagal mengunggah ' + file.name + ': ' + msg + '. Periksa izin Storage untuk akun admin.');
      }
      const publicResult = db.storage.from(NEWS_MEDIA_BUCKET).getPublicUrl(path);
      const publicUrl = publicResult?.data?.publicUrl;
      if (!publicUrl) throw new Error('Berkas terunggah, tetapi URL publik tidak berhasil dibuat. Periksa pengaturan bucket.');
      uploadedUrls.push(publicUrl);
    }
    return existingUrls.concat(uploadedUrls);
  }

  async function saveArticle(event, forcedStatus = null) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (actionRunning) return;
    const id = $('article-id')?.value || '';
    const title = $('title')?.value.trim() || '';
    const summary = $('summary')?.value.trim() || '';
    const body = $('body')?.value.trim() || '';
    const sourceRaw = $('source')?.value.trim() || '';
    const imageRaw = $('image')?.value.trim() || '';
    const mainImageFile = $('image-file')?.files?.[0] || null;
    const status = forcedStatus || $('status')?.value || 'draft';
    const sourceReportId = $('source-report-id')?.value || '';

    if (!title || !body) {
      message('article-message', 'Judul dan isi berita wajib diisi sebelum menyimpan atau menerbitkan.', true);
      return;
    }
    if (!['draft', 'review', 'published', 'archived'].includes(status)) {
      message('article-message', 'Status berita tidak valid.', true);
      return;
    }
    let sourceUrl, imageUrl;
    try {
      sourceUrl = validUrl(sourceRaw);
      imageUrl = validUrl(imageRaw);
    } catch (error) {
      message('article-message', error.message, true);
      return;
    }
    if (status === 'published') {
      const proceed = confirm('Terbitkan berita ini ke publik sekarang? Pastikan isi, fakta, dan sumber sudah diperiksa.');
      if (!proceed) return;
    }

    setActionBusy(true);
    message('article-message', status === 'published' ? 'Menerbitkan berita ke publik…' : 'Menyimpan berita…');
    try {
      const authorized = await verifyAdmin();
      if (!authorized) throw new Error('Sesi admin tidak aktif. Login kembali.');
      const existing = articles.find(article => article.id === id);
      const slugBase = slugify(title) || 'berita';
      const slug = existing?.slug || (slugBase + '-' + Date.now().toString(36));
      const now = new Date().toISOString();
      const location = getLocationValues();
      const oldMediaUrls = parseMediaUrls(existing?.media_urls);
      message('article-message', 'Mengunggah foto utama dan foto/video tambahan…');
      imageUrl = await uploadMainImage(mainImageFile, id || slug, imageUrl || existing?.image_path || null);
      const mediaUrls = await uploadSelectedMedia(id || slug, oldMediaUrls);
      const coreRecord = {
        title: title,
        slug: slug,
        summary: summary,
        body: body,
        source_url: sourceUrl,
        image_path: imageUrl,
        media_urls: mediaUrls,
        author_label: 'Redaksi LAPOR BERITA',
        status: status,
        published_at: status === 'published' ? (existing?.published_at || now) : null,
        updated_at: now
      };
      const fullRecord = Object.assign({}, coreRecord, location);
      let result = await writeArticle(id, fullRecord);
      if (result.error && isMissingColumn(result.error)) {
        const errorText = String(result.error.message || '').toLowerCase();
        if (errorText.includes('media_urls')) {
          throw new Error('Kolom media_urls belum tersedia di tabel articles. Media sudah mungkin terunggah, tetapi daftar medianya belum bisa disimpan ke database. Tambahkan kolom media_urls (tipe jsonb) sebelum mencoba lagi.');
        }
        locationWarning = 'Lokasi belum tersimpan karena kolom lokasi belum tersedia di database. Jalankan upgrade-schema.sql satu kali untuk mengaktifkannya.';
        const { media_urls, ...recordWithoutMedia } = coreRecord;
        result = await writeArticle(id, Object.assign({}, recordWithoutMedia, location));
        if (result.error && isMissingColumn(result.error)) result = await writeArticle(id, recordWithoutMedia);
      } else {
        locationWarning = '';
      }
      if (result.error) throw result.error;
      const savedId = result.data?.id || id;
      if ($('media-files')) $('media-files').value = '';
      if ($('image-file')) $('image-file').value = '';
      clearMediaPreviewUrls();
      clearMainImagePreviewUrl();
      renderSavedMedia(mediaUrls);
      if (imageUrl && $('image-preview')) {
        $('image-preview').replaceChildren();
        const savedImage = document.createElement('img');
        savedImage.src = imageUrl;
        savedImage.alt = 'Foto utama tersimpan';
        savedImage.style.maxWidth = '220px';
        savedImage.style.maxHeight = '180px';
        $('image-preview').appendChild(savedImage);
      }
      let reportWarning = '';
      if (status === 'published' && sourceReportId && savedId) {
        const reportUpdate = await db.from('public_reports').update({
          status: 'approved',
          published_article_id: savedId,
          reviewed_at: now
        }).eq('id', sourceReportId);
        if (reportUpdate.error) {
          console.error('Berita sudah terbit, tetapi status laporan gagal diperbarui:', reportUpdate.error);
          reportWarning = ' Berita berhasil terbit, tetapi status laporan sumber belum berhasil diperbarui: ' + reportUpdate.error.message;
        }
      }
      if (status === 'published') {
        resetForm();
      } else {
        if (savedId) $('article-id').value = savedId;
        if ($('form-title')) $('form-title').textContent = 'Edit Berita';
      }
      await refreshAll();
      if (status === 'published') {
        const link = savedId ? ' Tautan publik: ' + new URL('artikel.html?id=' + encodeURIComponent(savedId), locationHref()).href : '';
        message('article-message', 'BERHASIL DITERBITKAN. Berita sekarang berstatus publik.' + link + (locationWarning ? ' ' + locationWarning : '') + reportWarning);
      } else {
        message('article-message', 'Berita berhasil disimpan dengan status “' + status + '”. Formulir tetap terbuka agar dapat dilanjutkan atau diterbitkan setelah diperiksa.' + (locationWarning ? ' ' + locationWarning : ''));
      }
    } catch (error) {
      console.error('Simpan/terbitkan berita gagal:', error);
      message('article-message', 'Gagal menyimpan atau menerbitkan berita: ' + (error.message || 'kesalahan database'), true);
    } finally {
      setActionBusy(false);
    }
  }

  function locationHref() {
    return window.location.href.split('?')[0].replace(/admin\.html?$/i, '');
  }

  async function writeArticle(id, record) {
    if (id) {
      return await db.from('articles').update(record).eq('id', id).select('id').single();
    }
    return await db.from('articles').insert(record).select('id').single();
  }

  async function setArticleStatus(id, status) {
    const article = articles.find(item => item.id === id);
    if (!article) return;
    const labels = { published: 'menerbitkan ke publik', draft: 'menjadikan draf', review: 'memindahkan ke tinjauan' };
    if (!labels[status]) return;
    if (status === 'published' && !confirm('Terbitkan "' + article.title + '" ke publik sekarang? Pastikan isi dan sumber telah diperiksa.')) return;
    if (status !== 'published' && !confirm('Ubah status berita "' + article.title + '" menjadi ' + status + '?')) return;
    setActionBusy(true);
    message('article-message', 'Memperbarui status berita…');
    try {
      const authorized = await verifyAdmin();
      if (!authorized) throw new Error('Sesi admin tidak aktif. Login kembali.');
      const update = { status, published_at: status === 'published' ? (article.published_at || new Date().toISOString()) : null };
      const result = await db.from('articles').update(update).eq('id', id).select('id').maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error('Status tidak berubah. Periksa izin admin/RLS pada tabel articles.');
      message('article-message', 'Berhasil ' + labels[status] + '.');
      await refreshAll();
    } catch (error) {
      console.error('Perubahan status gagal:', error);
      message('article-message', 'Gagal mengubah status: ' + error.message, true);
    } finally {
      setActionBusy(false);
    }
  }

  async function deleteArticle(id) {
    if (actionRunning) return;
    const article = articles.find(item => item.id === id);
    if (!article) return;
    if (!confirm('Hapus permanen berita “' + article.title + '”? Tindakan ini tidak dapat dibatalkan.')) return;
    setActionBusy(true);
    message('article-message', 'Menghapus berita…');
    try {
      const authorized = await verifyAdmin();
      if (!authorized) throw new Error('Sesi admin tidak aktif. Login kembali.');
      const { error } = await db.from('articles').delete().eq('id', id);
      if (error) throw error;
      if ($('article-id')?.value === id) resetForm();
      await refreshAll();
      message('article-message', 'Berita berhasil dihapus permanen.');
    } catch (error) {
      console.error('Hapus berita gagal:', error);
      message('article-message', 'Gagal menghapus berita: ' + error.message, true);
    } finally {
      setActionBusy(false);
    }
  }

  async function deleteReport(id) {
    if (actionRunning) return;
    const report = reports.find(item => String(item.id) === String(id));
    if (!report) return;
    if (!confirm('HAPUS PERMANEN laporan “' + (report.title || '(Tanpa judul)') + '”? Data laporan terkait akan dihapus. Tindakan ini tidak dapat dibatalkan.')) return;
    setActionBusy(true);
    message('report-message', 'Menghapus laporan secara permanen…');
    try {
      const authorized = await verifyAdmin();
      if (!authorized) throw new Error('Sesi admin tidak aktif. Login kembali.');
      const result = await db.rpc('admin_delete_public_report', { p_report_id: id });
      if (result.error) throw result.error;
      if (result.data === false) throw new Error('Laporan tidak ditemukan atau tidak berhasil dihapus.');
      if (activeReport && String(activeReport.id) === String(id)) {
        $('report-detail-panel')?.classList.add('hidden');
        $('report-evidence')?.replaceChildren();
        activeReport = null;
      }
      await refreshAll();
      message('report-message', 'Laporan berhasil dihapus permanen.');
    } catch (error) {
      console.error('Hapus laporan gagal:', error);
      message('report-message', 'Gagal menghapus laporan: ' + error.message, true);
    } finally {
      setActionBusy(false);
    }
  }

  async function showReport(id) {
    const report = reports.find(item => String(item.id) === String(id));
    if (!report) {
      message('report-message', 'Laporan tidak ditemukan. Muat ulang daftar laporan.', true);
      return;
    }
    activeReport = report;

    const detail = $('report-detail');
    const evidence = $('report-evidence');
    const panel = $('report-detail-panel');
    panel?.classList.remove('hidden');

    if (detail) {
      const firstValue = keys => {
        for (const key of keys) {
          const value = report[key];
          if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
        }
        return '-';
      };
      const reporterName = firstValue(['reporter_name', 'nama_pelapor', 'full_name', 'name', 'nama', 'pelapor_nama']);
      const reporterNik = firstValue(['reporter_nik', 'nik_ktp', 'nik', 'ktp_number', 'nomor_ktp', 'pelapor_nik']);
      detail.textContent = 'Judul: ' + (report.title || '-') + '\n\n' +
        'Identitas Pelapor (RAHASIA ADMIN)\n' +
        'Nama: ' + reporterName + '\n' +
        'NIK: ' + reporterNik + '\n\n' +
        'Isi laporan:\n' + (report.body || '-') + '\n\n' +
        'Sumber: ' + (report.source_url || '-') + '\n\n' +
        'Status: ' + (report.status || '-') + '\n\n' +
        'Catatan pemeriksa: ' + (report.reviewer_notes || '-');
    }

    if (evidence) {
      evidence.replaceChildren();
      const loading = document.createElement('p');
      loading.className = 'muted';
      loading.textContent = 'Memeriksa izin admin dan memuat berkas laporan…';
      evidence.appendChild(loading);

      try {
        const authorized = await verifyAdmin();
        if (!authorized) throw new Error('Sesi admin berakhir. Silakan login kembali.');

        evidence.replaceChildren();
        const reportMedia = report.__laporBeritaEvidenceMedia || readReportMedia(report, 'evidence');
        const identityMedia = report.__laporBeritaIdentityMedia || readReportMedia(report, 'identity');

        const hasReportMedia = await renderReportMediaGroup(
          evidence, reportMedia, 'Foto / Video Bukti Laporan Masyarakat', false
        );
        const hasIdentityMedia = await renderReportMediaGroup(
          evidence, identityMedia, 'Foto KTP / Identitas Pelapor — RAHASIA ADMIN', true
        );

        if (!hasReportMedia && !hasIdentityMedia) {
          const note = document.createElement('p');
          note.className = 'muted';
          note.textContent = 'Belum ada jalur foto yang ditemukan pada data laporan ini. Foto harus memiliki jalur berkas di public_reports dan berkasnya tersedia di Storage.';
          evidence.appendChild(note);
        }
      } catch (error) {
        evidence.replaceChildren();
        const note = document.createElement('p');
        note.className = 'status';
        note.textContent = 'Bukti belum dapat ditampilkan: ' + (error?.message || 'kesalahan akses');
        evidence.appendChild(note);
        console.error('Gagal membuka bukti laporan:', error);
      }
    }

    panel?.scrollIntoView({ behavior: 'smooth' });
  }

  function useReportAsDraft(id) {
    const report = reports.find(item => String(item.id) === String(id));
    if (!report) return;
    resetForm();
    $('title').value = report.title || '';
    $('body').value = report.body || '';
    $('source').value = report.source_url || '';
    $('status').value = 'draft';
    $('source-report-id').value = report.id;
    if ($('form-title')) $('form-title').textContent = 'Periksa Laporan — Simpan sebagai Draf';
    message('article-message', 'Laporan dimasukkan sebagai draf. Verifikasi fakta dan sunting terlebih dahulu. Tombol “Terbitkan ke Publik” akan menerbitkan berita dan mencoba menandai laporan sebagai disetujui.');
    $('article-form')?.scrollIntoView({ behavior: 'smooth' });
  }

  async function fetchMetadata() {
    const raw = $('source')?.value?.trim();
    if (!raw) {
      message('article-message', 'Masukkan tautan sumber berita terlebih dahulu.', true);
      return;
    }
    let url;
    try { url = validUrl(raw); }
    catch (error) { message('article-message', error.message, true); return; }

    setActionBusy(true);
    message('article-message', 'Mengambil judul, gambar, dan isi berita dari tautan…');
    try {
      let title = '', summary = '', image = '', body = '';
      const metaFromHtml = html => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const meta = selector => doc.querySelector(selector)?.getAttribute('content')?.trim() || '';
        const absolute = value => { try { return value ? new URL(value, url).href : ''; } catch (_) { return ''; } };
        return {
          title: meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || doc.querySelector('h1')?.textContent?.trim() || doc.querySelector('title')?.textContent?.trim() || '',
          summary: meta('meta[property="og:description"]') || meta('meta[name="description"]') || meta('meta[name="twitter:description"]') || '',
          image: absolute(meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]') || meta('meta[itemprop="image"]')),
          body: Array.from(doc.querySelectorAll('article p, main p, [itemprop="articleBody"] p'))
            .map(p => p.textContent.trim()).filter(t => t.length > 35).join('\n\n')
        };
      };

      try {
        const response = await fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'follow' });
        if (response.ok) {
          const found = metaFromHtml(await response.text());
          title = found.title; summary = found.summary; image = found.image; body = found.body;
        }
      } catch (_) {}

      if (!title || !summary || !body || !image) {
        const response = await fetch('https://r.jina.ai/' + url, { method: 'GET', credentials: 'omit' });
        if (!response.ok) throw new Error('Layanan pembaca tautan menjawab ' + response.status);
        const text = await response.text();
        const lines = text.split(/\r?\n/);
        const cleanLines = lines.map(line => line.trim()).filter(Boolean);
        if (!title) {
          const titleLine = cleanLines.find(line => /^Title:\s*/i.test(line));
          const heading = cleanLines.find(line => /^#{1,2}\s+/.test(line));
          title = titleLine ? titleLine.replace(/^Title:\s*/i, '').trim()
            : heading ? heading.replace(/^#{1,2}\s+/, '').replace(/\s+#+$/, '').trim() : '';
        }
        if (!image) {
          const imageMatch = text.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/i);
          if (imageMatch) { try { image = new URL(imageMatch[1], url).href; } catch (_) {} }
        }
        const contentStart = Math.max(0, lines.findIndex(line => /^Markdown Content:/i.test(line)) + 1);
        const contentLines = lines.slice(contentStart);
        const paragraphs = [];
        let current = [];
        for (const line of contentLines) {
          const trimmed = line.trim();
          if (!trimmed) {
            if (current.length) { paragraphs.push(current.join(' ').trim()); current = []; }
            continue;
          }
          if (/^#{1,6}\s/.test(trimmed) || /^Title:/i.test(trimmed) || /^URL Source:/i.test(trimmed) ||
              /^Published Time:/i.test(trimmed) || /^!\[/.test(trimmed) || /^\[.*\]\(https?:\/\//i.test(trimmed)) {
            if (current.length) { paragraphs.push(current.join(' ').trim()); current = []; }
            continue;
          }
          current.push(trimmed.replace(/^>\s?/, '').replace(/^\*\s+/, ''));
        }
        if (current.length) paragraphs.push(current.join(' ').trim());
        const usable = paragraphs.filter(p => p.length > 45 && !/^https?:\/\//i.test(p));
        if (!summary && usable.length) summary = usable[0].slice(0, 500);
        if (!body && usable.length) body = usable.join('\n\n').slice(0, 100000);
      }

      if (title && !$('title').value.trim()) $('title').value = title;
      if (summary && !$('summary').value.trim()) $('summary').value = summary;
      if (body && !$('body').value.trim()) $('body').value = body;
      if (image && !$('image').value.trim()) $('image').value = image;

      if (title || summary || body || image) {
        const got = [];
        if (title) got.push('judul');
        if (summary) got.push('ringkasan');
        if (body) got.push('isi berita');
        if (image) got.push('gambar');
        message('article-message', 'Berhasil mengambil: ' + got.join(', ') + '. Periksa fakta, hak cipta, dan sunting dengan bahasa sendiri sebelum diterbitkan.');
      } else {
        throw new Error('Metadata dan isi artikel tidak ditemukan.');
      }
    } catch (error) {
      console.warn('Pengambilan metadata repost gagal:', error);
      message('article-message', 'Gagal mengambil otomatis. Situs sumber mungkin memblokir akses. Coba tautan artikel langsung; bila tetap gagal, isi manual. Tautan sumber tetap tersimpan.', true);
    } finally {
      setActionBusy(false);
    }
  }

  async function publishReport(id) {
    if (actionRunning) return;
    const report = reports.find(item => String(item.id) === String(id));
    if (!report) {
      message('report-message', 'Laporan tidak ditemukan. Muat ulang data.', true);
      return;
    }
    if (report.status === 'approved' && report.published_article_id) {
      message('report-message', 'Laporan ini sudah diterbitkan. ID berita: ' + report.published_article_id);
      return;
    }
    const ok = confirm('Terbitkan laporan “' + (report.title || '(Tanpa judul)') + '” sebagai berita publik sekarang? Pastikan isi laporan sudah diperiksa. Data pribadi pelapor tidak akan diterbitkan.');
    if (!ok) return;
    const title = String(report.title || '').trim();
    const body = String(report.body || '').trim();
    if (!title || !body) {
      message('report-message', 'Laporan tidak memiliki judul atau isi. Buka “Periksa” dan lengkapi sebagai draf terlebih dahulu.', true);
      return;
    }
    setActionBusy(true);
    message('report-message', 'Menerbitkan laporan sebagai berita publik…');
    try {
      const authorized = await verifyAdmin();
      if (!authorized) throw new Error('Sesi admin tidak aktif. Silakan login kembali.');
      const now = new Date().toISOString();
      const slug = (slugify(title) || 'laporan') + '-' + Date.now().toString(36);
      const record = {
        title,
        slug,
        summary: body.slice(0, 450),
        body,
        category_id: report.proposed_category_id || null,
        source_url: validUrl(String(report.source_url || '').trim()),
        image_path: null,
        author_label: 'Laporan Masyarakat — Redaksi LAPOR BERITA',
        status: 'published',
        published_at: now,
        updated_at: now
      };
      const inserted = await db.from('articles').insert(record).select('id').single();
      if (inserted.error) throw inserted.error;
      const updated = await db.from('public_reports').update({
        status: 'approved',
        published_article_id: inserted.data.id,
        reviewed_at: now
      }).eq('id', report.id);
      if (updated.error) {
        message('report-message', 'Berita sudah terbit, tetapi status laporan gagal diperbarui: ' + updated.error.message + '. Jangan tekan Terbitkan lagi agar tidak membuat duplikat.', true);
      } else {
        message('report-message', 'Berhasil diterbitkan ke publik. Judul: ' + title + '.');
      }
      await refreshAll();
    } catch (error) {
      console.error('Penerbitan laporan gagal:', error);
      message('report-message', 'Gagal menerbitkan laporan: ' + (error.message || 'kesalahan database'), true);
    } finally {
      setActionBusy(false);
    }
  }

  function previewMedia() {
    clearMediaPreviewUrls();
    const input = $('media-files');
    const preview = $('media-preview');
    if (!input || !preview) return;
    preview.replaceChildren();
    Array.from(input.files || []).slice(0, 10).forEach(file => {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) return;
      const url = URL.createObjectURL(file);
      mediaPreviewUrls.push(url);
      const item = document.createElement('div');
      item.style.margin = '8px 0';
      if (file.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = url; img.alt = file.name; img.style.maxWidth = '140px'; img.style.maxHeight = '110px';
        item.appendChild(img);
      } else {
        const video = document.createElement('video');
        video.src = url; video.controls = true; video.style.maxWidth = '220px';
        item.appendChild(video);
      }
      const label = document.createElement('div');
      label.textContent = file.name + ' — siap diunggah saat berita disimpan';
      item.appendChild(label); preview.appendChild(item);
    });
    if ((input.files || []).length > 10) message('article-message', 'Maksimal 10 berkas pertama yang akan diproses saat berita disimpan.');
  }

  function previewMainImage() {
    clearMainImagePreviewUrl();
    const preview = $('image-preview');
    const file = $('image-file')?.files?.[0];
    if (preview) preview.replaceChildren();
    if (!file || !preview) return;
    if (!file.type.startsWith('image/')) {
      message('article-message', 'Pilih berkas gambar untuk foto utama.', true);
      return;
    }
    imagePreviewUrl = URL.createObjectURL(file);
    const img = document.createElement('img');
    img.src = imagePreviewUrl; img.alt = 'Pratinjau foto pilihan';
    preview.appendChild(img);
    message('article-message', 'Foto utama siap diunggah. Tekan Simpan Berita agar foto tersimpan permanen di Storage.');
  }

  function setOptions(select, items, placeholder) {
    if (!select) return;
    const html = ['<option value="">' + esc(placeholder) + '</option>'];
    (items || []).forEach(item => {
      html.push('<option value="' + esc(item.id) + '">' + esc(item.name) + '</option>');
    });
    select.innerHTML = html.join('');
  }

  async function loadRegionList(path) {
    const response = await fetch(REGION_API + path, { cache: 'force-cache' });
    if (!response.ok) throw new Error('Layanan daftar wilayah menjawab ' + response.status + '.');
    const json = await response.json();
    const rows = Array.isArray(json) ? json : (Array.isArray(json.data) ? json.data : []);
    return rows.map(row => ({ id: String(row.id), name: String(row.name || row.nama || '') })).filter(row => row.id && row.name);
  }

  async function loadProvinces() {
    const select = $('province-select');
    if (!select) return [];
    if (regionListsReady && provinceCache.length) return provinceCache;
    select.disabled = true;
    setOptions(select, [], 'Memuat provinsi…');
    try {
      provinceCache = await loadRegionList('/provinces.json');
      setOptions(select, provinceCache, 'Pilih provinsi');
      regionListsReady = true;
      select.disabled = false;
      return provinceCache;
    } catch (error) {
      console.warn('Daftar provinsi tidak tersedia:', error);
      setOptions(select, [], 'Daftar tidak tersedia — isi lokasi manual');
      select.disabled = true;
      message('article-message', 'Daftar wilayah tidak berhasil dimuat. Lokasi manual tetap dapat digunakan.');
      return [];
    }
  }

  async function loadChildren(kind, parentId) {
    if (!parentId) return [];
    const paths = {
      regency: '/regencies/' + encodeURIComponent(parentId) + '.json',
      district: '/districts/' + encodeURIComponent(parentId) + '.json',
      village: '/villages/' + encodeURIComponent(parentId) + '.json'
    };
    if (!paths[kind]) return [];
    return await loadRegionList(paths[kind]);
  }

  async function handleProvinceChange() {
    clearLocationChildren();
    const selected = $('province-select')?.value || '';
    if ($('regency-select')) $('regency-select').disabled = true;
    if ($('district-select')) $('district-select').disabled = true;
    if ($('village-select')) $('village-select').disabled = true;
    if (selected) {
      try {
        const rows = await loadChildren('regency', selected);
        setOptions($('regency-select'), rows, 'Pilih kabupaten/kota');
        if ($('regency-select')) $('regency-select').disabled = false;
      } catch (error) {
        setOptions($('regency-select'), [], 'Daftar gagal dimuat — isi lokasi manual');
        message('article-message', 'Kabupaten/kota gagal dimuat. Silakan gunakan lokasi manual.');
      }
    }
    updateRegionDisplay();
  }

  async function handleRegencyChange() {
    setOptions($('district-select'), [], 'Memuat kecamatan…');
    setOptions($('village-select'), [], 'Pilih kecamatan dahulu');
    if ($('district-select')) $('district-select').disabled = true;
    if ($('village-select')) $('village-select').disabled = true;
    const selected = $('regency-select')?.value || '';
    if (selected) {
      try {
        const rows = await loadChildren('district', selected);
        setOptions($('district-select'), rows, 'Pilih kecamatan');
        if ($('district-select')) $('district-select').disabled = false;
      } catch (error) {
        setOptions($('district-select'), [], 'Daftar gagal dimuat — isi lokasi manual');
      }
    }
    updateRegionDisplay();
  }

  async function handleDistrictChange() {
    setOptions($('village-select'), [], 'Memuat kelurahan/desa…');
    if ($('village-select')) $('village-select').disabled = true;
    const selected = $('district-select')?.value || '';
    if (selected) {
      try {
        const rows = await loadChildren('village', selected);
        setOptions($('village-select'), rows, 'Pilih kelurahan/desa');
        if ($('village-select')) $('village-select').disabled = false;
      } catch (error) {
        setOptions($('village-select'), [], 'Daftar gagal dimuat — isi lokasi manual');
      }
    }
    updateRegionDisplay();
  }

  function selectedName(id) {
    const select = $(id);
    if (!select || !select.value) return '';
    return select.selectedOptions?.[0]?.textContent?.trim() || '';
  }

  function getLocationValues() {
    const regency = selectedName('regency-select');
    const regionType = $('region-type')?.value || 'nasional';
    return {
      region_type: regionType,
      province: selectedName('province-select'),
      regency: regency,
      city: regionType === 'kota' ? regency : '',
      district: selectedName('district-select'),
      village: selectedName('village-select'),
      location_manual: $('location-manual')?.value.trim() || '',
      location_detail: $('location-detail')?.value.trim() || ''
    };
  }

  function updateRegionDisplay() {
    const values = [
      selectedName('province-select'), selectedName('regency-select'), selectedName('district-select'),
      selectedName('village-select'), $('location-manual')?.value.trim(), $('location-detail')?.value.trim()
    ].filter(Boolean);
    if ($('region-display')) $('region-display').value = [...new Set(values)].join(', ');
  }

  function findOptionByName(select, name) {
    if (!select || !name) return false;
    const option = Array.from(select.options).find(item => item.value && item.textContent.trim().toLocaleLowerCase('id') === String(name).trim().toLocaleLowerCase('id'));
    if (!option) return false;
    select.value = option.value;
    return true;
  }

  async function restoreLocation(article) {
    const provinces = await loadProvinces();
    if (!provinces.length) return;
    if (article.region_type && $('region-type')) $('region-type').value = article.region_type;
    if (!findOptionByName($('province-select'), article.province)) { updateRegionDisplay(); return; }
    await handleProvinceChange();
    if (findOptionByName($('regency-select'), article.regency || article.city)) await handleRegencyChange();
    if (findOptionByName($('district-select'), article.district)) await handleDistrictChange();
    findOptionByName($('village-select'), article.village);
    updateRegionDisplay();
  }

  async function editArticle(id) {
    const article = articles.find(item => item.id === id);
    if (!article) return;
    resetForm();
    $('article-id').value = article.id;
    $('title').value = article.title || '';
    $('summary').value = article.summary || '';
    $('body').value = article.body || '';
    $('source').value = article.source_url || '';
    $('image').value = article.image_path || '';
    renderSavedMedia(parseMediaUrls(article.media_urls));
    $('status').value = article.status || 'draft';
    if ($('location-manual')) $('location-manual').value = article.location_manual || '';
    if ($('location-detail')) $('location-detail').value = article.location_detail || '';
    if ($('form-title')) $('form-title').textContent = 'Edit Berita';
    try { await restoreLocation(article); } catch (error) { console.warn('Lokasi lama tidak dapat dipulihkan:', error); }
    updateRegionDisplay();
    message('article-message', 'Berita dimuat ke formulir. Periksa kembali isinya, lalu simpan atau terbitkan.');
    $('article-form')?.scrollIntoView({ behavior: 'smooth' });
  }

  function setupEvents() {
    $('login-form')?.addEventListener('submit', login);
    $('logout-btn')?.addEventListener('click', logout);
    $('refresh-btn')?.addEventListener('click', refreshAll);
    $('article-form')?.addEventListener('submit', event => saveArticle(event));
    $('publish-btn')?.addEventListener('click', () => saveArticle(null, 'published'));
    $('fetch-btn')?.addEventListener('click', fetchMetadata);
    $('cancel-btn')?.addEventListener('click', resetForm);
    $('media-files')?.addEventListener('change', previewMedia);
    $('image-file')?.addEventListener('change', previewMainImage);
    $('province-select')?.addEventListener('change', handleProvinceChange);
    $('regency-select')?.addEventListener('change', handleRegencyChange);
    $('district-select')?.addEventListener('change', handleDistrictChange);
    ['village-select', 'region-type', 'location-manual', 'location-detail'].forEach(id => {
      $(id)?.addEventListener('change', updateRegionDisplay);
      $(id)?.addEventListener('input', updateRegionDisplay);
    });
    $('close-report-btn')?.addEventListener('click', () => {
      $('report-detail-panel')?.classList.add('hidden');
      $('report-evidence')?.replaceChildren();
      activeReport = null;
    });
    document.addEventListener('click', event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const edit = target.closest('[data-edit-article]');
      const statusArticle = target.closest('[data-set-article-status]');
      const delArticle = target.closest('[data-delete-article]');
      const delReport = target.closest('[data-delete-report]');
      const view = target.closest('[data-view-report]');
      const use = target.closest('[data-use-report]');
      const publishReportButton = target.closest('[data-publish-report]');
      if (statusArticle) setArticleStatus(statusArticle.dataset.articleId, statusArticle.dataset.setArticleStatus);
      else if (edit) editArticle(edit.dataset.editArticle);
      else if (delArticle) deleteArticle(delArticle.dataset.deleteArticle);
      else if (delReport) deleteReport(delReport.dataset.deleteReport);
      else if (view) showReport(view.dataset.viewReport);
      else if (use) useReportAsDraft(use.dataset.useReport);
      else if (publishReportButton) publishReport(publishReportButton.dataset.publishReport);
    });
  }

  async function init() {
    setupEvents();
    loadProvinces();
    try {
      checkConfig();
      message('login-message', 'Memeriksa sesi admin…');
      const sessionResult = await db.auth.getSession();
      if (sessionResult.error) throw sessionResult.error;
      if (sessionResult.data?.session) {
        const authorized = await verifyAdmin();
        if (authorized) {
          showAdmin();
          if ($('session-info')) $('session-info').textContent = 'Login sebagai ' + (currentUser?.email || 'Admin');
          await refreshAll();
          return;
        }
      }
      showLogin();
      message('login-message', 'Silakan login menggunakan akun admin.');
    } catch (error) {
      console.error('Inisialisasi admin gagal:', error);
      showLogin();
      message('login-message', 'Panel belum siap: ' + error.message, true);
    }
  }

  init();
})();
