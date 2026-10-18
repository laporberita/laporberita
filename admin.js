(()=>{
'use strict';

const $=id=>document.getElementById(id);
const cfg=window.LAPOR_BERITA_CONFIG;
let db=null,session=null,cache=[],reportCache=[];

const say=(id,s)=>$(id).textContent=s;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

const slug=s=>String(s||'').toLowerCase().normalize('NFD')
 .replace(/[\u0300-\u036f]/g,'')
 .replace(/[^a-z0-9]+/g,'-')
 .replace(/^-|-$/g,'').slice(0,170)||'berita';

function setOptions(el,items,placeholder){
 el.innerHTML='';
 const first=document.createElement('option');
 first.value='';first.textContent=placeholder;el.appendChild(first);
 (items||[]).forEach(x=>{
  const o=document.createElement('option');
  o.value=x.code;o.textContent=x.name;el.appendChild(o);
 });
}

const API='https://www.emsifa.com/api-wilayah-indonesia/v2/';

async function wilayah(url){
 const res=await fetch(url);
 if(!res.ok)throw Error('Daftar wilayah gagal dimuat.');
 const json=await res.json();
 const rows=Array.isArray(json)?json:(json.data||[]);
 return rows.map(x=>({code:x.code||x.id,name:x.name}));
}

async function loadProvinces(){
 try{
  const d=await wilayah(API+'provinces.json');
  setOptions($('province-select'),d,'Pilih provinsi');
  $('province-select').disabled=false;
  say('article-message','Daftar provinsi berhasil dimuat.');
 }catch(e){
  setOptions($('province-select'),[],'Daftar gagal dimuat');
  say('article-message','Daftar wilayah gagal dimuat. Lokasi manual tetap bisa digunakan.');
 }
}

function clearBelow(level){
 if(level<=1){
  setOptions($('regency-select'),[],'Pilih kabupaten/kota dahulu');
  $('regency-select').disabled=true;
 }
 if(level<=2){
  setOptions($('district-select'),[],'Pilih kecamatan dahulu');
  $('district-select').disabled=true;
 }
 if(level<=3){
  setOptions($('village-select'),[],'Pilih kelurahan/desa dahulu');
  $('village-select').disabled=true;
 }
 refreshLocation();
}

async function fillSelect(parentId,childId,url,placeholder,nextLevel){
 const code=$(parentId).value;
 clearBelow(nextLevel);
 if(!code)return;
 try{
  const d=await wilayah(url(code));
  setOptions($(childId),d,placeholder);
  $(childId).disabled=false;
 }catch(e){
  say('article-message','Daftar wilayah gagal dimuat. Isi lokasi manual bila diperlukan.');
 }
}

$('province-select').addEventListener('change',()=>
 fillSelect('province-select','regency-select',
 c=>API+'regencies/'+c+'.json','Pilih kabupaten/kota',1).then(refreshLocation));

$('regency-select').addEventListener('change',()=>
 fillSelect('regency-select','district-select',
 c=>API+'districts/'+c+'.json','Pilih kecamatan',2).then(refreshLocation));

$('district-select').addEventListener('change',()=>
 fillSelect('district-select','village-select',
 c=>API+'villages/'+c+'.json','Pilih kelurahan/desa',3).then(refreshLocation));

['village-select','region-type','location-manual','location-detail']
 .forEach(id=>$(id).addEventListener('change',refreshLocation));

function selectedName(id){
 const el=$(id);
 return el.value?el.options[el.selectedIndex].text:'';
}

function refreshLocation(){
 const parts=[
  selectedName('village-select'),selectedName('district-select'),
  selectedName('regency-select'),selectedName('province-select'),
  $('location-manual').value.trim()
 ].filter(Boolean);

 $('region-display').value=[...new Set(parts)].join(' • ')||
  ($('region-type').value==='nasional'?'Nasional':'Lokasi belum dipilih');
}

function detect(text){
 const t=(text||'').toLowerCase();
 const provinces=[
  'Sumatera Utara','Aceh','Sumatera Barat','Riau','Kepulauan Riau',
  'Jambi','Sumatera Selatan','Bengkulu','Lampung','DKI Jakarta',
  'Jawa Barat','Jawa Tengah','DI Yogyakarta','Jawa Timur','Banten',
  'Bali','Nusa Tenggara Barat','Nusa Tenggara Timur','Kalimantan Barat',
  'Kalimantan Tengah','Kalimantan Selatan','Kalimantan Timur',
  'Kalimantan Utara','Sulawesi Utara','Sulawesi Tengah','Sulawesi Selatan',
  'Sulawesi Tenggara','Gorontalo','Sulawesi Barat','Maluku',
  'Maluku Utara','Papua','Papua Barat','Papua Selatan','Papua Tengah',
  'Papua Pegunungan','Papua Barat Daya'
 ];
 return provinces.find(x=>t.includes(x.toLowerCase()))||'';
}

function autoregion(){
 const p=detect($('title').value+' '+$('body').value);
 if(p&&!$('province-select').value){
  const opt=[...$('province-select').options]
   .find(o=>o.textContent.toLowerCase()===p.toLowerCase());
  if(opt)$('province-select').value=opt.value;
 }
 refreshLocation();
}

function authShow(ok){
 $('login-panel').classList.toggle('hidden',ok);
 $('admin-panel').classList.toggle('hidden',!ok);
}

async function isAdmin(){
 if(!session)return false;
 const {data,error}=await db.rpc('is_site_admin');
 if(error)throw Error('Pemeriksaan admin gagal: '+error.message);
 if(data!==true)throw Error('Akun masuk tetapi belum memiliki hak admin.');
 return true;
}

async function verify(){
 if(!session)throw Error('Silakan login kembali.');
 await isAdmin();
 return true;
}

function locationOf(a){
 return [
  a.village,a.district,a.regency,a.city,a.province,a.location_manual
 ].filter(Boolean).join(' • ')||a.region_type||'—';
}

/* DAFTAR BERITA */
async function load(){
 const {data,error}=await db.from('articles')
  .select('*').order('created_at',{ascending:false}).limit(100);

 if(error)throw error;
 cache=data||[];

 $('article-list').innerHTML=cache.map(a=>`
 <tr>
  <td>${esc(a.title)}</td>
  <td>${esc(locationOf(a))}</td>
  <td>${esc(a.status)}</td>
  <td>${a.created_at?new Date(a.created_at).toLocaleDateString('id-ID'):'—'}</td>
  <td>
   <div class="report-actions">
    <button type="button" class="button" data-edit="${esc(a.id)}">Edit</button>
    <button type="button" class="button danger" data-delete-article="${esc(a.id)}">Hapus</button>
   </div>
  </td>
 </tr>`).join('')||'<tr><td colspan="5">Belum ada berita.</td></tr>';

 document.querySelectorAll('[data-edit]').forEach(b=>{
  b.onclick=()=>edit(cache.find(a=>a.id===b.dataset.edit));
 });
 document.querySelectorAll('[data-delete-article]').forEach(b=>{
  b.onclick=()=>deleteArticle(b.dataset.deleteArticle);
 });

 await loadReports();
}

/* HAPUS BERITA */
async function deleteArticle(id){
 const a=cache.find(x=>x.id===id);
 if(!a)return;

 if(!window.confirm('Hapus berita ini secara permanen?\n\n'+a.title+
  '\n\nTindakan ini tidak dapat dibatalkan.'))return;

 try{
  await verify();
  const {error}=await db.from('articles').delete().eq('id',id);
  if(error)throw error;

  say('article-message','Berita berhasil dihapus.');
  await load();
 }catch(e){
  say('article-message','Gagal menghapus berita: '+e.message);
 }
}

/* DAFTAR LAPORAN MASYARAKAT */
async function loadReports(){
 say('report-message','Memuat laporan masyarakat...');

 try{
  const {data,error}=await db.from('public_reports')
   .select('*').order('created_at',{ascending:false}).limit(100);

  if(error)throw error;
  reportCache=data||[];

  if(!reportCache.length){
   $('report-list').innerHTML='<tr><td colspan="4">Belum ada laporan masyarakat.</td></tr>';
   say('report-message','Belum ada laporan yang tercatat.');
   $('report-detail-panel').classList.add('hidden');
   return;
  }

  $('report-list').innerHTML=reportCache.map(r=>{
   const done=Boolean(r.published_article_id);
   const status=done?'Sudah diterbitkan':(r.status||'Dikirim');

   return `<tr>
    <td>${esc(r.title||'(Tanpa judul)')}</td>
    <td>${esc(status)}</td>
    <td>${r.created_at?new Date(r.created_at).toLocaleDateString('id-ID'):'—'}</td>
    <td>
     <div class="report-actions">
      <button type="button" class="button secondary" data-inspect-report="${esc(r.id)}">Periksa</button>
      ${done?'':`<button type="button" class="button" data-publish-report="${esc(r.id)}">Terbitkan</button>`}
      <button type="button" class="button danger" data-delete-report="${esc(r.id)}">Hapus</button>
     </div>
    </td>
   </tr>`;
  }).join('');

  document.querySelectorAll('[data-inspect-report]').forEach(b=>{
   b.onclick=()=>inspectReport(b.dataset.inspectReport);
  });
  document.querySelectorAll('[data-publish-report]').forEach(b=>{
   b.onclick=()=>publishReport(b.dataset.publishReport);
  });
  document.querySelectorAll('[data-delete-report]').forEach(b=>{
   b.onclick=()=>deleteReport(b.dataset.deleteReport);
  });

  say('report-message','Laporan berhasil dimuat: '+reportCache.length+' laporan.');

 }catch(e){
  $('report-list').innerHTML='<tr><td colspan="4">Laporan tidak dapat dimuat.</td></tr>';
  say('report-message','Gagal memuat laporan. Periksa izin admin pada tabel public_reports. '+e.message);
 }
}

/* HAPUS LAPORAN */
async function deleteReport(id){
 const r=reportCache.find(x=>x.id===id);
 if(!r)return;

 if(!window.confirm('Hapus laporan masyarakat ini secara permanen?\n\n'+
  (r.title||'(Tanpa judul)')+
  '\n\nTindakan ini tidak dapat dibatalkan.'))return;

 try{
  await verify();
  const {error}=await db.from('public_reports').delete().eq('id',id);
  if(error)throw error;

  $('report-detail-panel').classList.add('hidden');
  say('report-message','Laporan berhasil dihapus.');
  await loadReports();
 }catch(e){
  say('report-message','Gagal menghapus laporan: '+e.message);
 }
}

function inspectReport(id){
 const r=reportCache.find(x=>x.id===id);
 if(!r)return;

 const source=String(r.source_url||'').trim();
 const safeSource=/^https?:\/\//i.test(source)
  ?`<p><b>Sumber:</b> <a href="${esc(source)}" target="_blank" rel="noopener noreferrer">${esc(source)}</a></p>`
  :'<p><b>Sumber:</b> Tidak dicantumkan</p>';

 $('report-detail').innerHTML=
  `<p><b>Judul:</b> ${esc(r.title||'—')}</p>`+
  `<p><b>Status laporan:</b> ${esc(r.status||'Dikirim')}</p>`+
  `<p><b>Isi laporan:</b></p><div>${esc(r.body||'—')}</div>`+
  safeSource+
  `<p><b>Tanggal masuk:</b> ${r.created_at?esc(new Date(r.created_at).toLocaleString('id-ID')):'—'}</p>`+
  (r.published_article_id
   ?'<p><b>Catatan:</b> Laporan ini sudah ditautkan ke berita yang diterbitkan.</p>'
   :'<p><b>Langkah berikutnya:</b> Periksa isi laporan, lalu tekan Terbitkan jika disetujui.</p>');

 $('report-detail-panel').classList.remove('hidden');
 $('report-detail-panel').scrollIntoView({behavior:'smooth',block:'start'});
}

$('close-report-btn').onclick=()=>{
 $('report-detail-panel').classList.add('hidden');
};

/* TERBITKAN LAPORAN */
async function publishReport(id){
 const r=reportCache.find(x=>x.id===id);
 if(!r)return;

 if(r.published_article_id){
  say('report-message','Laporan ini sudah ditautkan ke berita terbit.');
  return;
 }

 const title=String(r.title||'').trim();
 const body=String(r.body||'').trim();

 if(!title||!body){
  say('report-message','Judul atau isi laporan kosong.');
  return;
 }

 if(!window.confirm('Apakah laporan sudah diperiksa dan disetujui?\n\n'+
  title+'\n\nBerita akan langsung diterbitkan.'))return;

 say('report-message','Menerbitkan laporan...');

 try{
  await verify();
  const now=new Date().toISOString();

  const article={
   title,
   slug:slug(title)+'-'+String(r.id).slice(0,8),
   summary:body.length>220?body.slice(0,217)+'...':body,
   body,
   source_url:r.source_url||null,
   image_path:null,
   status:'published',
   updated_at:now,
   published_at:now,
   region_type:null,
   province:null,
   regency:null,
   city:null,
   district:null,
   village:null,
   location_manual:null,
   location_detail:null
  };

  const {data:created,error:createError}=await db
   .from('articles').insert(article).select('id').single();

  if(createError)throw createError;

  const {error:updateError}=await db.from('public_reports')
   .update({published_article_id:created.id,reviewed_at:now})
   .eq('id',r.id);

  if(updateError){
   say('report-message',
    'Berita sudah diterbitkan, tetapi penanda laporan gagal diperbarui. Jangan terbitkan lagi. '+updateError.message);
   await load();
   return;
  }

  say('report-message','Laporan disetujui dan berita berhasil diterbitkan.');
  await load();

 }catch(e){
  say('report-message','Gagal menerbitkan laporan: '+e.message);
 }
}

async function chooseByName(selectId,name){
 if(!name)return;
 const el=$(selectId);
 const op=[...el.options]
  .find(o=>o.textContent.toLowerCase()===String(name).toLowerCase());
 if(op)el.value=op.value;
}

async function edit(a){
 if(!a)return;
 reset();

 $('article-id').value=a.id;
 $('title').value=a.title||'';
 $('summary').value=a.summary||'';
 $('body').value=a.body||'';
 $('source').value=a.source_url||'';
 $('image').value=a.image_path||'';
 $('status').value=a.status||'draft';
 $('region-type').value=a.region_type||'';
 $('location-manual').value=a.location_manual||'';
 $('location-detail').value=a.location_detail||'';

 await chooseByName('province-select',a.province);

 if($('province-select').value){
  await fillSelect('province-select','regency-select',
   c=>API+'regencies/'+c+'.json','Pilih kabupaten/kota',1);
  await chooseByName('regency-select',a.regency||a.city);

  if($('regency-select').value){
   await fillSelect('regency-select','district-select',
    c=>API+'districts/'+c+'.json','Pilih kecamatan',2);
   await chooseByName('district-select',a.district);

   if($('district-select').value){
    await fillSelect('district-select','village-select',
     c=>API+'villages/'+c+'.json','Pilih kelurahan/desa',3);
    await chooseByName('village-select',a.village);
   }
  }
 }

 refreshLocation();
 $('form-title').textContent='Edit Berita';
 window.scrollTo({top:0,behavior:'smooth'});
}

function reset(){
 $('article-form').reset();
 $('article-id').value='';
 $('form-title').textContent='Buat Berita';
 $('media-preview').textContent='';

 setOptions($('regency-select'),[],'Pilih kabupaten/kota dahulu');
 setOptions($('district-select'),[],'Pilih kecamatan dahulu');
 setOptions($('village-select'),[],'Pilih kelurahan/desa dahulu');

 $('regency-select').disabled=true;
 $('district-select').disabled=true;
 $('village-select').disabled=true;
 refreshLocation();
}

/* LOGIN DAN PEMUATAN */
async function init(){
 try{
  if(!cfg||!window.supabase)throw Error('Konfigurasi Supabase/pustaka belum tersedia.');

  db=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY);
  await loadProvinces();

  const {data,error}=await db.auth.getSession();
  if(error)throw error;

  if(data.session){
   session=data.session;
   await isAdmin();
   authShow(true);
   $('session-info').textContent='Login: '+session.user.email;
   await load();
  }else{
   say('login-message','Konfigurasi siap. Silakan login admin.');
  }
 }catch(e){
  say('login-message',e.message);
 }
}

$('login-form').onsubmit=async e=>{
 e.preventDefault();

 try{
  const {data,error}=await db.auth.signInWithPassword({
   email:$('email').value.trim(),
   password:$('password').value
  });
  if(error)throw error;

  session=data.session;
  await isAdmin();
  authShow(true);
  $('session-info').textContent='Login: '+session.user.email;
  await load();
 }catch(e){
  say('login-message','Login gagal atau data gagal dimuat: '+e.message);
 }
};

$('logout-btn').onclick=async()=>{
 await db.auth.signOut();
 session=null;
 authShow(false);
};

$('refresh-btn').onclick=async()=>{
 try{
  await verify();
  await load();
  say('article-message','Data berita diperbarui.');
 }catch(e){
  say('article-message',e.message);
 }
};

$('cancel-btn').onclick=reset;
$('title').addEventListener('input',autoregion);
$('body').addEventListener('input',autoregion);

$('fetch-btn').onclick=async()=>{
 const url=$('source').value.trim();
 if(!/^https?:\/\//i.test(url)){
  say('article-message','Tempel tautan lengkap yang diawali https://');
  return;
 }

 try{
  say('article-message','Menghubungi layanan tarik data...');
  const {data,error}=await db.functions.invoke('tarik-data-berita',{body:{url}});
  if(error)throw error;

  if(data.title)$('title').value=data.title;
  if(data.body)$('body').value=data.body;
  if(data.summary)$('summary').value=data.summary;
  if(data.image)$('image').value=data.image;

  autoregion();
  say('article-message','Data berhasil ditarik. Periksa dan sunting sebelum disimpan.');
 }catch(e){
  say('article-message','Tarik data belum aktif atau sumber membatasi akses. '+e.message);
 }
};

$('media-files').onchange=()=>{
 const files=[...$('media-files').files];
 if(files.length+($('image-file').files.length?1:0)>10){
  $('media-files').value='';
  say('article-message','Maksimal 10 foto/video per berita.');
  return;
 }
 $('media-preview').textContent=files.length+' berkas dipilih. Berkas belum diunggah ke server.';
};

$('article-form').onsubmit=async e=>{
 e.preventDefault();

 try{
  await verify();

  const title=$('title').value.trim();
  const status=$('status').value;
  const province=selectedName('province-select');
  const regency=selectedName('regency-select');
  const district=selectedName('district-select');
  const village=selectedName('village-select');

  const row={
   title,
   slug:slug(title),
   summary:$('summary').value.trim()||null,
   body:$('body').value.trim(),
   source_url:$('source').value.trim()||null,
   image_path:$('image').value.trim()||null,
   status,
   updated_at:new Date().toISOString(),
   published_at:status==='published'?new Date().toISOString():null,
   region_type:$('region-type').value||null,
   province:province||null,
   regency:regency||null,
   city:$('region-type').value==='kota'?regency:null,
   district:district||null,
   village:village||null,
   location_manual:$('location-manual').value.trim()||null,
   location_detail:$('location-detail').value.trim()||null
  };

  const q=$('article-id').value
   ?db.from('articles').update(row).eq('id',$('article-id').value)
   :db.from('articles').insert(row);

  const {error}=await q;
  if(error)throw error;

  say('article-message','Berita tersimpan. Unggahan media belum aktif sampai Storage disiapkan.');
  reset();
  await load();

 }catch(e){
  say('article-message','Gagal menyimpan: '+e.message);
 }
};

init();
})();
