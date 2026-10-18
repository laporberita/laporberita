
(()=>{'use strict';

const $ = id => document.getElementById(id);
const cfg = window.LAPOR_BERITA_CONFIG;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

const date = s => s
  ? new Date(s).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
  : 'Berita pendidikan';

let db = null;

try {
  if (cfg && window.supabase) {
    db = window.supabase.createClient(
      cfg.SUPABASE_URL,
      cfg.SUPABASE_PUBLISHABLE_KEY
    );
  }
} catch (e) {
  console.error('Konfigurasi Supabase gagal:', e);
}

if ($('year')) {
  $('year').textContent = new Date().getFullYear();
}

async function load() {
  const latest = $('latest-list');
  const grid = $('article-grid');
  const all = $('all-news');
  const status = $('database-status');

  if (!db) {
    if (status) {
      status.textContent =
        'Database belum terhubung. Periksa supabase-config.js.';
    }
    if (all) {
      all.innerHTML =
        '<p class="muted">Konfigurasi database belum tersedia.</p>';
    }
    return;
  }

  try {
    if (status) {
      status.textContent = 'Memuat berita dari database...';
    }

    const { data, error } = await db
      .from('articles')
      .select(
        'id,title,slug,summary,body,image_path,source_url,created_at,published_at,status,region_type,province,regency,city'
      )
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(all ? 60 : 12);

    if (error) throw error;

    const items = data || [];

    function makeCard(a) {
      const location =
        a.city || a.regency || a.province || a.region_type || 'Pendidikan';

      const image =
        a.image_path ||
        'https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=700&q=75';

      return `
        <article class="article-card">
          <a href="artikel.html?id=${encodeURIComponent(a.id)}">
            <img
              loading="lazy"
              src="${esc(image)}"
              alt="Foto berita"
            >
            <div class="pad">
              <span class="tag">${esc(location)}</span>
              <h3>${esc(a.title)}</h3>
              <p>${esc(a.summary || '')}</p>
              <small>${esc(date(a.published_at || a.created_at))}</small>
            </div>
          </a>
        </article>
      `;
    }

    if (latest) {
      latest.innerHTML = items.slice(0, 4).map(a => `
        <a
          class="latest-item"
          href="artikel.html?id=${encodeURIComponent(a.id)}"
        >
          <img
            class="thumb"
            src="${esc(a.image_path || 'https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=300&q=70')}"
            alt="Foto berita"
          >
          <span>
            <b>${esc(a.title)}</b>
            <small>${esc(date(a.published_at || a.created_at))}</small>
          </span>
        </a>
      `).join('') ||
      '<p class="muted">Belum ada berita terbit.</p>';
    }

    if (grid) {
      grid.innerHTML = items.slice(0, 6).map(makeCard).join('') ||
        '<p class="muted">Belum ada berita terbit.</p>';
    }

    if (all) {
      all.innerHTML = items.map(makeCard).join('') ||
        '<p class="muted">Belum ada berita terbit.</p>';
    }

    if (status) {
      status.textContent =
        'Berita berhasil dimuat: ' + items.length + ' berita.';
    }

  } catch (e) {
    console.error('Gagal memuat berita:', e);

    if (status) {
      status.textContent =
        'Gagal memuat berita dari database: ' +
        (e.message || 'Periksa koneksi dan izin Supabase.');
    }

    if (all) {
      all.innerHTML =
        '<p class="muted">Berita belum dapat dimuat. Silakan coba lagi.</p>';
    }

    if (latest) {
      latest.innerHTML =
        '<p class="muted">Berita gagal dimuat dari database.</p>';
    }

    if (grid) {
      grid.innerHTML =
        '<p class="muted">Berita gagal dimuat dari database.</p>';
    }
  }
}

const searchForm = $('search-form');

if (searchForm) {
  searchForm.addEventListener('submit', e => {
    e.preventDefault();

    const searchInput = $('search-input');

    if (searchInput) {
      location.href =
        'kategori.html?q=' +
        encodeURIComponent(searchInput.value.trim());
    }
  });
}

load();

})();
