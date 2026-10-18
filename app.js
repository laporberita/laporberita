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

function showMessage(element, message) {
  if (element) {
    element.innerHTML = '<p class="muted">' + esc(message) + '</p>';
  }
}

function makeCard(a) {
  const image = a.image_path || fallbackImage;

  return `
    <article class="article-card">
      <a href="artikel.html?id=${encodeURIComponent(a.id)}">
        <img
          loading="lazy"
          src="${esc(image)}"
          alt="Foto berita"
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
    const message =
      'Database belum terhubung. Periksa konfigurasi Supabase.';

    if (status) status.textContent = message;
    showMessage(latest, message);
    showMessage(grid, message);
    showMessage(all, message);
    return;
  }

  try {
    if (status) {
      status.textContent = 'Memuat berita dari database...';
    }

    const { data, error } = await db
      .from('articles')
      .select(
        'id,title,summary,image_path,created_at,published_at,status'
      )
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(all ? 60 : 12);

    if (error) throw error;

    const items = data || [];

    if (latest) {
      latest.innerHTML = items.slice(0, 4).map(a => `
        <a
          class="latest-item"
          href="artikel.html?id=${encodeURIComponent(a.id)}"
        >
          <img
            class="thumb"
            src="${esc(a.image_path || fallbackImage)}"
            alt="Foto berita"
            onerror="this.onerror=null;this.src='${fallbackImage}'"
          >
          <span>
            <b>${esc(a.title || 'Tanpa judul')}</b>
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

    const message =
      'Gagal memuat berita dari database: ' +
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
      location.href =
        'kategori.html?q=' +
        encodeURIComponent(searchInput.value.trim());
    }
  });
}

load();

})();
