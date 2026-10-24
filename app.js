(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const cfg = window.LAPOR_BERITA_CONFIG;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

  const date = s => {
    if (!s) return 'Berita pendidikan';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return 'Berita pendidikan';
    return d.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  const fallbackImage =
    'https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=700&q=75';
  const PUBLIC_MEDIA_BUCKET = 'berita-media';
  let db = null;

  // Decode each path segment safely, preserving folder separators.
  function decodePath(value) {
    return String(value || '').split('/').map(part => {
      try { return decodeURIComponent(part); }
      catch (_) { return part; }
    }).join('/');
  }

  function encodeObjectPath(value) {
    return decodePath(value).split('/').filter(Boolean)
      .map(part => encodeURIComponent(part)).join('/');
  }

  function publicStorageUrl(objectPath) {
    const base = String(cfg?.SUPABASE_URL || '').replace(/\/+$/, '');
    if (!base || !objectPath) return null;
    const cleanPath = decodePath(objectPath).replace(/^\/+/, '');
    if (!cleanPath || cleanPath.split('/').some(part => part === '..')) return null;
    return base + '/storage/v1/object/public/' + PUBLIC_MEDIA_BUCKET + '/' + encodeObjectPath(cleanPath);
  }

  /*
   * articles.image_path normally stores the public URL returned by Supabase.
   * Older rows may store only the object path. Convert paths only to the public
   * news bucket. Never turn a private laporan-bukti path into a public URL.
   */
  function resolvePublicImage(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const raw = value.trim();
    const projectBase = String(cfg?.SUPABASE_URL || '').replace(/\/+$/, '');
    let projectOrigin = '';
    try { projectOrigin = new URL(projectBase).origin; } catch (_) {}

    const inspectStorageUrl = candidate => {
      let parsed;
      try { parsed = new URL(candidate, projectBase || window.location.href); }
      catch (_) { return { recognized: false, value: null }; }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { recognized: true, value: null };
      }
      const match = parsed.pathname.match(
        /\/storage\/v1\/(?:object|render\/image)\/(public|sign|authenticated)\/([^/]+)\/(.+)$/i
      );
      if (!match) return { recognized: false, value: parsed.href };
      const bucket = decodePath(match[2]).toLowerCase();
      const objectPath = decodePath(match[3].split('?')[0]);
      // A URL on this project's private bucket must never be exposed publicly.
      if (parsed.origin === projectOrigin && bucket !== PUBLIC_MEDIA_BUCKET) {
        return { recognized: true, value: null };
      }
      if (bucket === PUBLIC_MEDIA_BUCKET) {
        return { recognized: true, value: publicStorageUrl(objectPath) || parsed.href };
      }
      return { recognized: true, value: null };
    };

    if (/^https?:\/\//i.test(raw)) {
      const result = inspectStorageUrl(raw);
      return result.value;
    }

    // Handle a storage URL path saved without its domain.
    if (/^(?:\/?storage\/v1\/|\/?(?:object|render\/image)\/)/i.test(raw) ||
        /\/(?:object|render\/image)\/(?:public|sign|authenticated)\//i.test(raw)) {
      const result = inspectStorageUrl(raw.startsWith('/') ? raw : '/' + raw);
      if (result.recognized) return result.value;
    }

    let path = raw.replace(/^\/+/, '');
    if (/^laporan-bukti\//i.test(path)) return null;
    path = path.replace(/^berita-media\//i, '');
    // A bare object path is interpreted as an object in the public news bucket.
    return publicStorageUrl(path);
  }

  try {
    if (cfg?.SUPABASE_URL && cfg?.SUPABASE_PUBLISHABLE_KEY && window.supabase?.createClient) {
      db = window.supabase.createClient(
        cfg.SUPABASE_URL,
        cfg.SUPABASE_PUBLISHABLE_KEY
      );
    }
  } catch (e) {
    console.error('Konfigurasi Supabase gagal:', e);
  }

  if ($('year')) $('year').textContent = new Date().getFullYear();

  function showMessage(element, message) {
    if (element) element.innerHTML = '<p class="muted">' + esc(message) + '</p>';
  }

  function makeCard(a) {
    const image = resolvePublicImage(a.image_path) || fallbackImage;
    return `
      <article class="article-card">
        <a href="artikel.html?id=${encodeURIComponent(a.id)}">
          <img
            loading="lazy"
            decoding="async"
            src="${esc(image)}"
            alt="Foto berita: ${esc(a.title || 'Berita pendidikan')}"
            onerror="this.onerror=null;this.src='${fallbackImage}'"
          >
          <div class="pad">
            <span class="tag">Berita Pendidikan</span>
            <h3>${esc(a.title || 'Tanpa judul')}</h3>
            <p>${esc(a.summary || '')}</p>
            <small>${esc(date(a.published_at || a.created_at))}</small>
          </div>
        </a>
      </article>
    `;
  }

  async function load() {
    const latest = $('latest-list');
    const grid = $('article-grid');
    const all = $('all-news');
    const status = $('database-status');

    if (!db) {
      const message = 'Database belum terhubung. Periksa konfigurasi Supabase.';
      if (status) status.textContent = message;
      showMessage(latest, message);
      showMessage(grid, message);
      showMessage(all, message);
      return;
    }

    try {
      if (status) status.textContent = 'Memuat berita dari database...';

      const { data, error } = await db
        .from('articles')
        .select('id,title,summary,image_path,created_at,published_at,status')
        .eq('status', 'published')
        .order('created_at', { ascending: false })
        .limit(all ? 60 : 12);

      if (error) throw error;
      const items = data || [];

      if (latest) {
        latest.innerHTML = items.slice(0, 4).map(a => {
          const image = resolvePublicImage(a.image_path) || fallbackImage;
          return `
            <a class="latest-item" href="artikel.html?id=${encodeURIComponent(a.id)}">
              <img class="thumb" loading="lazy" decoding="async"
                src="${esc(image)}" alt="Foto berita: ${esc(a.title || 'Berita pendidikan')}"
                onerror="this.onerror=null;this.src='${fallbackImage}'">
              <span>
                <b>${esc(a.title || 'Tanpa judul')}</b>
                <small>${esc(date(a.published_at || a.created_at))}</small>
              </span>
            </a>
          `;
        }).join('') || '<p class="muted">Belum ada berita terbit.</p>';
      }

      if (grid) {
        grid.innerHTML = items.slice(0, 6).map(makeCard).join('') ||
          '<p class="muted">Belum ada berita terbit.</p>';
      }

      if (all) {
        all.innerHTML = items.map(makeCard).join('') ||
          '<p class="muted">Belum ada berita terbit.</p>';
      }

      if (status) status.textContent = 'Berita berhasil dimuat: ' + items.length + ' berita.';
    } catch (e) {
      console.error('Gagal memuat berita:', e);
      const message = 'Gagal memuat berita dari database: ' +
        (e.message || 'Periksa koneksi Supabase.');
      if (status) status.textContent = message;
      showMessage(latest, message);
      showMessage(grid, message);
      showMessage(all, message);
    }
  }

  const searchForm = $('search-form');
  if (searchForm) {
    searchForm.addEventListener('submit', e => {
      e.preventDefault();
      const searchInput = $('search-input');
      if (searchInput) {
        location.href = 'kategori.html?q=' + encodeURIComponent(searchInput.value.trim());
      }
    });
  }

  load();
})();
