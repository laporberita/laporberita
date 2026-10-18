
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const cfg = window.LAPOR_BERITA_CONFIG;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));

  const date = value => {
    if (!value) return '-';
    const d = new Date(value);
    return Number.isNaN(d.getTime())
      ? '-'
      : d.toLocaleString('id-ID', {
          dateStyle: 'medium',
          timeStyle: 'short'
        });
  };

  const slugify = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);

  const validUrl = value => {
    if (!value) return '';
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Tautan harus menggunakan HTTP atau HTTPS.');
    }
    return url.href;
  };

  let db = null;
  let currentUser = null;
  let articles = [];
  let reports = [];
  let activeReport = null;
  let mediaUrls = [];
  let busy = false;

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

  function setBusy(value) {
    busy = value;
    ['save-btn', 'fetch-btn', 'refresh-btn', 'logout-btn']
      .forEach(id => {
        const el = $(id);
        if (el) el.disabled = value;
      });
  }

  function checkConfig() {
    if (!cfg?.SUPABASE_URL || !cfg?.SUPABASE_PUBLISHABLE_KEY) {
      throw new Error(
        'Konfigurasi Supabase belum lengkap. Periksa supabase-config.js.'
      );
    }

    if (!window.supabase?.createClient) {
      throw new Error(
        'Pustaka Supabase belum termuat. Periksa koneksi internet.'
      );
    }

    db = window.supabase.createClient(
      cfg.SUPABASE_URL,
      cfg.SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );
  }

  async function verifyAdmin() {
    const { data: userResult, error: userError } =
      await db.auth.getUser();

    if (userError || !userResult?.user) {
      currentUser = null;
      return false;
    }

    currentUser = userResult.user;

    // Hak admin wajib diperiksa di database.
    const { data, error } = await db.rpc('is_site_admin');

    if (error) {
      console.error('Pemeriksaan hak admin gagal:', error);
      throw new Error(
        'Hak admin belum dapat diverifikasi. Periksa fungsi is_site_admin() dan izin Supabase.'
      );
    }

    const authorized = data === true;

    if (!authorized) {
      await db.auth.signOut();
      currentUser = null;
      throw new Error(
        'Akun berhasil masuk, tetapi belum memiliki hak admin LAPOR BERITA.'
      );
    }

    return true;
  }

  async function login(event) {
    event.preventDefault();

    if (busy) return;

    const email = $('email')?.value.trim();
    const password = $('password')?.value;

    if (!email || !password) {
      message('login-message', 'Email dan kata sandi wajib diisi.', true);
      return;
    }

    setBusy(true);
    message('login-message', 'Memeriksa akun admin...');

    try {
      const { error } = await db.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      await verifyAdmin();
      showAdmin();

      if ($('session-info')) {
        $('session-info').textContent =
          'Login sebagai ' + (currentUser.email || 'Admin');
      }

      await refreshAll();
    } catch (error) {
      console.error('Login admin gagal:', error);
      message(
        'login-message',
        error.message || 'Login gagal. Periksa akun dan konfigurasi.',
        true
      );
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (!db) return;

    setBusy(true);

    try {
      const { error } = await db.auth.signOut();
      if (error) throw error;

      currentUser = null;
      showLogin();
      message('login-message', 'Anda telah keluar dari panel admin.');
    } catch (error) {
      message('login-message', 'Gagal keluar: ' + error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function refreshAll() {
    if (!db || !currentUser) return;

    setBusy(true);
    message('report-message', 'Memuat laporan...');
    message('article-message', 'Memuat berita...');

    try {
      const authorized = await verifyAdmin();

      if (!authorized) {
        showLogin();
        return;
      }

      const [articleResult, reportResult] = await Promise.all([
        db.from('articles')
          .select(
            'id,title,slug,summary,body,category_id,image_path,author_label,source_url,status,published_at,created_at,updated_at,district,village,location_manual,location_detail'
          )
          .order('created_at', { ascending: false })
          .limit(200),

        db.from('public_reports')
          .select(
            'id,title,body,source_url,status,reviewer_notes,published_article_id,created_at,reviewed_at'
          )
          .order('created_at', { ascending: false })
          .limit(200)
      ]);

      if (articleResult.error) throw articleResult.error;
      if (reportResult.error) throw reportResult.error;

      articles = articleResult.data || [];
      reports = reportResult.data || [];

      renderArticles();
      renderReports();

      message('article-message', 'Berita dimuat: ' + articles.length);
      message('report-message', 'Laporan dimuat: ' + reports.length);
    } catch (error) {
      console.error('Gagal memuat panel:', error);
      message(
        'article-message',
        'Gagal memuat berita: ' + error.message,
        true
      );
      message(
        'report-message',
        'Gagal memuat laporan: ' + error.message,
        true
      );
    } finally {
      setBusy(false);
    }
  }

  function renderArticles() {
    const tbody = $('article-list');
    if (!tbody) return;

    const published = articles.filter(a => a.status === 'published').length;

    if ($('total-articles')) {
      $('total-articles').textContent = articles.length;
    }

    if (!articles.length) {
      tbody.innerHTML =
        '<tr><td colspan="5">Belum ada berita. Silakan buat berita baru.</td></tr>';
      return;
    }

    tbody.innerHTML = articles.map(a => {
      const location = [
        a.village,
        a.district,
        a.location_manual
      ].filter(Boolean).join(', ');

      return `
        <tr>
          <td>${esc(a.title)}</td>
          <td>${esc(location || '-')}</td>
          <td>${esc(a.status || '-')}</td>
          <td>${esc(date(a.created_at))}</td>
          <td>
            <div class="toolbar">
              <button type="button" class="button secondary"
                data-edit-article="${esc(a.id)}">Edit</button>
              <button type="button" class="button danger"
                data-delete-article="${esc(a.id)}">Hapus</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Statistik hanya diperbarui jika elemen tersedia.
    if ($('published-articles')) {
      $('published-articles').textContent = published;
    }
  }

  function renderReports() {
    const tbody = $('report-list');
    if (!tbody) return;

    if (!reports.length) {
      tbody.innerHTML =
        '<tr><td colspan="4">Belum ada laporan masyarakat.</td></tr>';
      return;
    }

    tbody.innerHTML = reports.map(report => `
      <tr>
        <td>${esc(report.title || '(Tanpa judul)')}</td>
        <td>${esc(report.status || 'Menunggu pemeriksaan')}</td>
        <td>${esc(date(report.created_at))}</td>
        <td>
          <div class="report-actions">
            <button type="button" class="button secondary"
              data-view-report="${esc(report.id)}">Periksa</button>
            <button type="button" class="button"
              data-use-report="${esc(report.id)}">Jadikan draf</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function resetForm() {
    $('article-form')?.reset();

    if ($('article-id')) $('article-id').value = '';
    if ($('form-title')) $('form-title').textContent = 'Buat Berita';
    if ($('status')) $('status').value = 'draft';
    if ($('province-select')) {
      $('province-select').value = '';
    }
    if ($('regency-select')) {
      $('regency-select').value = '';
    }
    if ($('district-select')) {
      $('district-select').value = '';
    }
    if ($('village-select')) {
      $('village-select').value = '';
    }
    if ($('region-display')) {
      $('region-display').value = '';
    }
    if ($('media-preview')) $('media-preview').replaceChildren();

    mediaUrls.forEach(url => URL.revokeObjectURL(url));
    mediaUrls = [];

    message('article-message', 'Form dikosongkan.');
  }

  function editArticle(id) {
    const article = articles.find(item => item.id === id);
    if (!article) return;

    $('article-id').value = article.id;
    $('title').value = article.title || '';
    $('summary').value = article.summary || '';
    $('body').value = article.body || '';
    $('source').value = article.source_url || '';
    $('image').value = article.image_path || '';
    $('status').value = article.status || 'draft';

    if ($('district-select')) {
      $('district-select').value = article.district || '';
    }

    if ($('village-select')) {
      $('village-select').value = article.village || '';
    }

    if ($('location-manual')) {
      $('location-manual').value = article.location_manual || '';
    }

    if ($('location-detail')) {
      $('location-detail').value = article.location_detail || '';
    }

    if ($('form-title')) {
      $('form-title').textContent = 'Edit Berita';
    }

    message('article-message', 'Berita dimuat ke formulir. Periksa sebelum menyimpan.');
    $('article-form')?.scrollIntoView({ behavior: 'smooth' });
  }

  function getLocationValues() {
    const district = $('district-select')?.value || '';
    const village = $('village-select')?.value || '';
    const manual = $('location-manual')?.value.trim() || '';
    const detail = $('location-detail')?.value.trim() || '';

    // Kolom province/regency/region_type tidak dikirim karena
    // belum termasuk kolom articles yang terkonfirmasi.
    return {
      district,
      village,
      location_manual: manual,
      location_detail: detail
    };
  }

  async function saveArticle(event) {
    event.preventDefault();

    if (busy) return;

    setBusy(true);
    message('article-message', 'Menyimpan berita...');

    try {
      await verifyAdmin();

      const id = $('article-id')?.value || '';
      const title = $('title')?.value.trim() || '';
      const summary = $('summary')?.value.trim() || '';
      const body = $('body')?.value.trim() || '';
      const sourceRaw = $('source')?.value.trim() || '';
      const imageRaw = $('image')?.value.trim() || '';
      const status = $('status')?.value || 'draft';

      if (!title || !body) {
        throw new Error('Judul dan isi berita wajib diisi.');
      }

      if (!['draft', 'review', 'published', 'archived'].includes(status)) {
        throw new Error('Status berita tidak valid.');
      }

      const source_url = sourceRaw ? validUrl(sourceRaw) : null;
      const image_path = imageRaw ? validUrl(imageRaw) : null;

      const existing = articles.find(a => a.id === id);
      const slugBase = slugify(title) || 'berita';
      const slug = existing?.slug || (
        slugBase + '-' + Date.now().toString(36)
      );

      const record = {
        title,
        slug,
        summary,
        body,
        source_url,
        image_path,
        author_label: 'Redaksi LAPOR BERITA',
        status,
        ...getLocationValues(),
        published_at: status === 'published'
          ? (existing?.published_at || new Date().toISOString())
          : null,
        updated_at: new Date().toISOString()
      };

      let result;

      if (id) {
        result = await db.from('articles')
          .update(record)
          .eq('id', id)
          .select('id')
          .single();
      } else {
        result = await db.from('articles')
          .insert(record)
          .select('id')
          .single();
      }

      if (result.error) throw result.error;

      resetForm();
      message('article-message', 'Berita berhasil disimpan.');
      await refreshAll();
    } catch (error) {
      console.error('Simpan berita gagal:', error);
      message(
        'article-message',
        'Berita gagal disimpan: ' + error.message,
        true
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteArticle(id) {
    const article = articles.find(item => item.id === id);
    if (!article) return;

    if (!confirm(
      'Hapus berita "' + article.title + '"? Tindakan ini tidak dapat dibatalkan.'
    )) return;

    setBusy(true);

    try {
      await verifyAdmin();

      const { error } = await db.from('articles')
        .delete()
        .eq('id', id);

      if (error) throw error;

      message('article-message', 'Berita berhasil dihapus.');
      await refreshAll();
    } catch (error) {
      message('article-message', 'Gagal menghapus berita: ' + error.message, true);
    } finally {
      setBusy(false);
    }
  }

  function showReport(id) {
    const report = reports.find(item => item.id === id);
    if (!report) return;

    activeReport = report;

    const detail = $('report-detail');
    if (detail) {
      // Data pribadi pelapor tidak diambil dari tabel ini.
      detail.textContent =
        'Judul: ' + (report.title || '-') + '\n\n' +
        'Isi laporan:\n' + (report.body || '-') + '\n\n' +
        'Sumber: ' + (report.source_url || '-') + '\n\n' +
        'Status: ' + (report.status || '-') + '\n\n' +
        'Catatan pemeriksa: ' + (report.reviewer_notes || '-');
    }

    $('report-detail-panel')?.classList.remove('hidden');
    $('report-detail-panel')?.scrollIntoView({ behavior: 'smooth' });
  }

  function useReportAsDraft(id) {
    const report = reports.find(item => item.id === id);
    if (!report) return;

    resetForm();

    $('title').value = report.title || '';
    $('body').value = report.body || '';
    $('source').value = report.source_url || '';
    $('status').value = 'draft';

    message(
      'article-message',
      'Laporan dimasukkan sebagai draf. Periksa fakta dan sunting sebelum menerbitkan.'
    );

    $('article-form')?.scrollIntoView({ behavior: 'smooth' });
  }

  async function fetchMetadata() {
    const raw = $('source')?.value.trim();

    if (!raw) {
      message('article-message', 'Masukkan tautan sumber terlebih dahulu.', true);
      return;
    }

    let url;

    try {
      url = validUrl(raw);
    } catch (error) {
      message('article-message', error.message, true);
      return;
    }

    setBusy(true);
    message('article-message', 'Mencoba mengambil judul dan ringkasan dari tautan...');

    try {
      // Banyak situs menolak permintaan lintas domain (CORS).
      // Kegagalan tidak akan menghapus isi formulir.
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        redirect: 'follow'
      });

      if (!response.ok) {
        throw new Error('Situs sumber menolak permintaan (' + response.status + ').');
      }

      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      const meta = selector =>
        doc.querySelector(selector)?.getAttribute('content')?.trim() || '';

      const title =
        meta('meta[property="og:title"]') ||
        meta('meta[name="twitter:title"]') ||
        doc.querySelector('title')?.textContent?.trim() || '';

      const summary =
        meta('meta[property="og:description"]') ||
        meta('meta[name="description"]') ||
        meta('meta[name="twitter:description"]') || '';

      const image =
        meta('meta[property="og:image"]') ||
        meta('meta[name="twitter:image"]') || '';

      if (title && !$('title').value.trim()) $('title').value = title;
      if (summary && !$('summary').value.trim()) $('summary').value = summary;

      if (image && !$('image').value.trim()) {
        try {
          $('image').value = new URL(image, url).href;
        } catch (_) {
          // Abaikan URL gambar yang tidak valid.
        }
      }

      message(
        'article-message',
        title
          ? 'Metadata berhasil diambil. Periksa dan lengkapi isi berita secara manual.'
          : 'Judul tidak ditemukan. Silakan isi berita secara manual.'
      );
    } catch (error) {
      console.warn('Metadata tidak dapat diambil:', error);

      message(
        'article-message',
        'Tautan tidak dapat diambil otomatis karena pembatasan situs sumber. Isi judul, ringkasan, isi, dan foto secara manual.'
      );
    } finally {
      setBusy(false);
    }
  }

  function previewMedia() {
    const input = $('media-files');
    const preview = $('media-preview');

    if (!input || !preview) return;

    mediaUrls.forEach(url => URL.revokeObjectURL(url));
    mediaUrls = [];
    preview.replaceChildren();

    const files = Array.from(input.files || []).slice(0, 10);

    files.forEach(file => {
      if (!file.type.startsWith('image/') &&
          !file.type.startsWith('video/')) return;

      const url = URL.createObjectURL(file);
      mediaUrls.push(url);

      const item = document.createElement('div');
      item.style.margin = '8px 0';

      if (file.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = file.name;
        img.style.maxWidth = '140px';
        img.style.maxHeight = '110px';
        item.appendChild(img);
      } else {
        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.style.maxWidth = '220px';
        item.appendChild(video);
      }

      const label = document.createElement('div');
      label.textContent = file.name + ' — pratinjau lokal, belum diunggah';
      item.appendChild(label);
      preview.appendChild(item);
    });

    if ((input.files || []).length > 10) {
      message('article-message', 'Hanya 10 berkas pertama yang ditampilkan.');
    }
  }

  function updateRegionDisplay() {
    const values = [
      $('province-select')?.selectedOptions?.[0]?.textContent,
      $('regency-select')?.selectedOptions?.[0]?.textContent,
      $('district-select')?.selectedOptions?.[0]?.textContent,
      $('village-select')?.selectedOptions?.[0]?.textContent,
      $('location-manual')?.value.trim(),
      $('location-detail')?.value.trim()
    ].filter(value => value && !/^(Pilih|Memuat)/i.test(value));

    if ($('region-display')) {
      $('region-display').value = [...new Set(values)].join(', ');
    }
  }

  function setupLocationNotice() {
    // Data lokasi tidak diisi dengan daftar palsu.
    // Dropdown harus dihubungkan ke sumber data wilayah yang benar.
    const province = $('province-select');
    const regency = $('regency-select');
    const district = $('district-select');
    const village = $('village-select');

    if (province && province.options.length <= 1) {
      province.innerHTML =
        '<option value="">Gunakan lokasi manual</option>';
    }

    if (regency) {
      regency.innerHTML =
        '<option value="">Gunakan lokasi manual</option>';
      regency.disabled = true;
    }

    if (district && district.options.length <= 1) {
      district.innerHTML =
        '<option value="">Isi lokasi manual bila perlu</option>';
      district.disabled = false;
    }

    if (village && village.options.length <= 1) {
      village.innerHTML =
        '<option value="">Isi lokasi manual bila perlu</option>';
      village.disabled = false;
    }

    [
      'province-select',
      'regency-select',
      'district-select',
      'village-select',
      'location-manual',
      'location-detail'
    ].forEach(id => {
      $(id)?.addEventListener('change', updateRegionDisplay);
      $(id)?.addEventListener('input', updateRegionDisplay);
    });
  }

  function setupEvents() {
    $('login-form')?.addEventListener('submit', login);
    $('logout-btn')?.addEventListener('click', logout);
    $('refresh-btn')?.addEventListener('click', refreshAll);
    $('article-form')?.addEventListener('submit', saveArticle);
    $('fetch-btn')?.addEventListener('click', fetchMetadata);
    $('cancel-btn')?.addEventListener('click', resetForm);
    $('media-files')?.addEventListener('change', previewMedia);
    $('close-report-btn')?.addEventListener('click', () => {
      $('report-detail-panel')?.classList.add('hidden');
      activeReport = null;
    });

    document.addEventListener('click', event => {
      const edit = event.target.closest('[data-edit-article]');
      const remove = event.target.closest('[data-delete-article]');
      const view = event.target.closest('[data-view-report]');
      const use = event.target.closest('[data-use-report]');

      if (edit) editArticle(edit.dataset.editArticle);
      if (remove) deleteArticle(remove.dataset.deleteArticle);
      if (view) showReport(view.dataset.viewReport);
      if (use) useReportAsDraft(use.dataset.useReport);
    });
  }

  async function init() {
    setupEvents();
    setupLocationNotice();

    try {
      checkConfig();
      message('login-message', 'Memeriksa sesi admin...');

      const { data, error } = await db.auth.getSession();
      if (error) throw error;

      if (data?.session) {
        const authorized = await verifyAdmin();

        if (authorized) {
          showAdmin();

          if ($('session-info')) {
            $('session-info').textContent =
              'Login sebagai ' + (currentUser?.email || 'Admin');
          }

          await refreshAll();
          return;
        }
      }

      showLogin();
      message('login-message', 'Silakan login menggunakan akun admin.');
    } catch (error) {
      console.error('Inisialisasi admin gagal:', error);
      showLogin();
      message(
        'login-message',
        'Panel belum siap: ' + error.message,
        true
      );
    }
  }

  init();
})();
