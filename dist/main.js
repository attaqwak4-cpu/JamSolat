// main.js — Paparan Waktu Solat + Slide Kuliah + Slide Info IMG (Google Sheet) + SOA/Azan/Iqamah
// Pastikan HTML ada elemen-elemen yang dirujuk (ID/class).

/* ================== KONFIG ================== */
// API Kuliah (array of objects — nama, tajuk, penceramah, jawatan, tarikh, masa, gambar, papar, lokasi, dll.)
const GOOGLE_SHEET_API_URL_KULIAH = "https://script.google.com/macros/s/AKfycbyvXKa_a8CxzBjM0vDTvIM5qiLkbK_CBLLltpjkFHMcsp1wP2z6XEDQogfTAY4s5etodw/exec";

// API Slide Info IMG (array of objects — medan wajib: slaidPNG, papar[checkbox])
const GOOGLE_SHEET_API_URL_INFOIMG = "https://script.google.com/macros/s/AKfycbySPZe8iiIAvfj78X0fdCgUObDI_w7Y8OiZPOAaCTo5wv-C56xleRg53dPmrZaangyILQ/exec";

// API Teks Bawah
const API_TEKS_BAWAH = "https://script.google.com/macros/s/AKfycbxT8BRBuAFI105LWZBd1zHBAwVgZxvbGd2oBsjKuirtJ4UHmUP23JLDRmnHKDcAZ3se/exec";

// Fallback jika API info tiada — optional (akan diguna jika senarai dari sheet kosong)
const INFO_IMAGES_FALLBACK = ["img/slide1.png","img/slide2.png","img/slide3.png"];

// Tempoh & tetapan paparan
const INFO_IMAGE_DURATION_MS   = 5000;        // tempoh setiap imej info
const INFO_CYCLE_INTERVAL_MS   = 1*60*1000;   // ulang tayang info+kuliah+teks setiap 1 minit
const INFO_FETCH_INTERVAL_MS   = 5*60*1000;   // refresh data slide info setiap 5 minit
const KULIAH_FETCH_INTERVAL_MS = 5*60*1000;   // refresh data kuliah setiap 5 minit
const TEKS_BAWAH_FETCH_INTERVAL_MS = 5*60*1000; // refresh data teks bawah setiap 5 minit
const KULIAH_ITEM_DURATION_MS  = 10*1000;     // setiap kuliah 10s
const IQAMAH_DEFAULT_MIN       = 5;           // default 5 min
const IQAMAH_MAP               = { Subuh:15, Zohor:12, Asar:10, Maghrib:10, Isyak:10 };
const SOLAT_SLIDE_DURATION_MS  = 10*60*1000;  // slide SOLAT (gelap) 10 minit
const SOA_WINDOW_SEC           = 300;         // SOA (5 min sebelum masuk waktu)
const SOLAT_LEWAY_SEC          = 2;           // leeway pengesanan masuk waktu (s)
const TEKS_ITEMS_PER_CYCLE     = 4;           // tayang 4 item teks berturut-turut sebelum ulang ke info
const DURASI_KHUTBAH = 45 * 60 * 1000; // 20 minit khutbah Jumaat

/* ================== STATE ================== */
let zon = localStorage.getItem("zon") || "PHG02";
let waktuSolat = {};
let tarikhHijriJAKIM = "";
let namaSolatSeterusnya = "";
let masaSeterusnya = null;
let lastTriggered = { nama: null, stamp: 0 }; // elak azan berganda

let senaraiKuliah = [];
let senaraiInfoImg = []; // datang dari Google Sheet (medan slaidPNG + papar)
let infoTimer = null;

// Senarai global teks bawah (diisi daripada API)
window.listTeksBawah = [];

/* ================== ELEMEN ================== */
const el = {
  zonSelect: document.getElementById("zon"),
  hariMinggu: document.getElementById("hari-minggu"),
  tarikhGregorian: document.getElementById("tarikh-gregorian"),
  tarikhHijri: document.getElementById("tarikh-hijri"),
  jamMasa: document.getElementById("jam-masa"),
  jamMeridiem: document.getElementById("jam-meridiem"),
  jamSaat: document.getElementById("jam-saat"),
  waktuContainer: document.getElementById("waktu-solat"),
  nextSolat: document.getElementById("next-solat"),
  teksBawah: document.getElementById("paparan-teks-bawah"),

  slideSoa: document.getElementById("slide-soa"),
  slideMasuk: document.getElementById("slide-masuk-waktu"),
  masukNama: document.getElementById("masuk-nama"),
  slideIqamah: document.getElementById("slide-iqamah"),
  slideIqamahCounter: document.getElementById("kiraan-iqamah"),
  azanAudio: document.getElementById("azan-audio"),

  slideSolat: document.getElementById("slide-solat"),
  slideKhutbah: document.getElementById("slide-khutbah"),

  // Guna struktur HTML sedia ada: #slide-info (container) + #slide-info-img (img)
  slideInfo: document.getElementById("slide-info"),
  slideInfoImg: document.getElementById("slide-info-img"),

  // Slide Kuliah
  slideKuliah: document.getElementById("slide-kuliah"),
  kuliahEls: {
    gambar: document.getElementById("kuliah-gambar"),
    nama: document.getElementById("kuliah-nama"),
    tajuk: document.getElementById("kuliah-tajuk"),
    penceramah: document.getElementById("kuliah-penceramah"),
    jawatan: document.getElementById("kuliah-jawatan"),
    tarikh: document.getElementById("kuliah-tarikh"),
    masa: document.getElementById("kuliah-masa"),
    lokasi: document.getElementById("kuliah-lokasi") // optional
  }
};

/* ================== UTIL ================== */
function pad(n){ return String(n).padStart(2,"0"); }
function showSlide(node, durationMs = 0) { if(node){ node.classList.add("show"); if(durationMs>0){ setTimeout(()=>hideSlide(node), durationMs); } } }
function hideSlide(node) { if(node){ node.classList.remove("show"); } }
function forwardSlashPath(u=""){ return String(u).replace(/\\/g,"/"); }

function tukarKe12Jam(waktuStr) {
  if (!waktuStr || !waktuStr.includes(":")) return { masa: waktuStr, meridiem: "" };
  const [jamStr, minStr] = waktuStr.split(":");
  let jam = parseInt(jamStr, 10);
  const min = parseInt(minStr, 10);
  const meridiem = jam >= 19 ? "mlm" : (jam >= 12 ? "ptg" : "pagi");
  if (jam === 0) jam = 12; else if (jam > 12) jam -= 12;
  return { masa: `${jam}:${String(min).padStart(2, "0")}`, meridiem };
}

// Tukar pelbagai bentuk link Google Drive kepada direct-view
function cleanImageUrl(u = "") {
  if (!u) return "";
  const url = forwardSlashPath(String(u).trim());
  const m1 = url.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
  if (m1) return `https://drive.google.com/uc?export=view&id=${m1[1]}`;
  const m2 = url.match(/drive\.google\.com\/open\?id=([^&]+)/i);
  if (m2) return `https://drive.google.com/uc?export=view&id=${m2[1]}`;
  const m3 = url.match(/[?&]id=([^&]+)/i);
  if (/drive\.google\.com/i.test(url) && m3) return `https://drive.google.com/uc?export=view&id=${m3[1]}`;
  return url;
}

// Preload image, return boolean ok/tidak
function preloadImage(url) {
  return new Promise(resolve => {
    if (!url) return resolve(false);
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}


/* ================== JAM & TARIKH ================== */
function paparkanJamDigital() {
  if (!el.jamMasa || !el.jamMeridiem || !el.jamSaat) return;
  function tick() {
    const now = new Date();
    let hour = now.getHours();
    const minute = pad(now.getMinutes());
    const second = pad(now.getSeconds());
    let meridiem = "pagi";
    if (hour >= 19) meridiem = "mlm"; else if (hour >= 12) meridiem = "ptg";
    let hour12 = hour % 12; if (hour12 === 0) hour12 = 12;
    el.jamMasa.textContent = `${hour12}:${minute}`;
    el.jamSaat.textContent = second;
    el.jamMeridiem.textContent = meridiem;
    requestAnimationFrame(tick);
  }
  tick();
}

function paparkanTarikhGregorian(){
  if (!el.tarikhGregorian) return;
  const now = new Date();
  const greg = now.toLocaleDateString("ms-MY", { year:'numeric', month:'long', day:'numeric' });
  el.tarikhGregorian.textContent = greg;
  if (el.hariMinggu) {
    const hari = ["Ahad","Isnin","Selasa","Rabu","Khamis","Jumaat","Sabtu"][now.getDay()];
    el.hariMinggu.textContent = hari;
  }
}

/* convert hijri iso (yyyy-mm-dd) to jawi with arabic month names */
function convertHijriJawi(iso) {
  if (!iso || typeof iso !== "string" || iso.indexOf("-")<0) return iso || "";
  const months = ["محرم","صفر","ربيع الأول","ربيع الآخر","جمادى الأولى","جمادى الآخرة","رجب","شعبان","رمضان","شوال","ذو القعدة","ذو الحجة"];
  const angka = ["٠","١","٢","٣","٤","٥","٦","٧","٨","٩"];
  const convNum = n => String(n).split("").map(ch => angka[+ch]||ch).join("");
  const [y,m,d] = iso.split("-").map(s=>parseInt(s,10));
  return `${convNum(d)} ${months[m-1]} ${convNum(y)}`;
}
function paparkanTarikhHijri(){
  if (!el.tarikhHijri) return;
  if (tarikhHijriJAKIM) el.tarikhHijri.innerHTML = convertHijriJawi(tarikhHijriJAKIM);
  else el.tarikhHijri.textContent = "-";
}

/* ================== AMBIL WAKTU SOLAT (e-Solat) ================== */
async function ambilWaktuSolatHarian() {
  try {
    const url = `https://www.e-solat.gov.my/index.php?r=esolatApi/takwimsolat&zone=${zon}&period=today`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data || !data.prayerTime || !data.prayerTime[0]) throw new Error("API e-Solat returned invalid");
    const jadual = data.prayerTime[0];

    // robust keys
    waktuSolat = {
      Imsak:   jadual.imsak || jadual.imsyak || "",
      Subuh:   jadual.fajr  || jadual.subuh || "",
      Syuruk:  jadual.syuruk || "",
      Dhuha:   jadual.dhuha  || "",
      Zohor:   jadual.dhuhr  || jadual.zohor || "",
      Asar:    jadual.asr    || "",
      Maghrib: jadual.maghrib|| "",
      Isyak:   jadual.isha   || jadual.isyak || ""
    };

    tarikhHijriJAKIM = jadual.hijri || "";
    // fallback simpan
    localStorage.setItem("waktuSolat", JSON.stringify(waktuSolat));
    localStorage.setItem("tarikhHijriJAKIM", tarikhHijriJAKIM);

    paparkanWaktuSolat();
    paparkanTarikhHijri();
    kiraNextSolat();
  } catch (err) {
    console.warn("ambilWaktuSolatHarian failed:", err);
    // fallback to localStorage if available
    const simpan = localStorage.getItem("waktuSolat");
    if (simpan) {
      try { waktuSolat = JSON.parse(simpan); } catch(e){ waktuSolat = {}; }
      tarikhHijriJAKIM = localStorage.getItem("tarikhHijriJAKIM") || "";
      paparkanWaktuSolat();
      paparkanTarikhHijri();
      kiraNextSolat();
    }
  }
}

function paparkanWaktuSolat() {
  if (!el.waktuContainer) return;
  el.waktuContainer.innerHTML = "";
  const order = ["Imsak","Subuh","Syuruk","Dhuha","Zohor","Asar","Maghrib","Isyak"];
  for (const nama of order) {
    const raw = waktuSolat[nama] || "--:--:--";
    const { masa, meridiem } = tukarKe12Jam(raw.slice(0,5));
    const item = document.createElement("div");
    item.className = "waktu-item";
    item.innerHTML = `
      <div class="nama-solat">${nama}</div>
      <div class="waktuSolat">
        <span class="solatTime">${masa}</span>
        <span class="meridiem">${meridiem}</span>
      </div>
    `;
    el.waktuContainer.appendChild(item);
  }
}

/* ================== UTIL: waktu string->Date (hari ini) ================== */
function waktuToDate(waktuStr, dayOffset=0) {
  if (!waktuStr || typeof waktuStr !== "string" || waktuStr.indexOf(":")<0) {
    return new Date(8640000000000000); // far future
  }
  const [h,m] = waktuStr.split(":").map(s=>parseInt(s,10));
  const d = new Date();
  d.setDate(d.getDate()+dayOffset);
  d.setHours(h,m,0,0);
  d.setSeconds(0,0);
  return d;
}

/* ================== NEXT SOLAT ================== */
function kiraNextSolat() {
  const now = new Date();
  const urutan = ["Subuh","Syuruk","Zohor","Asar","Maghrib","Isyak"];
  for (const s of urutan) {
    const w = waktuToDate(waktuSolat[s]);
    if (now < w) {
      namaSolatSeterusnya = s;
      masaSeterusnya = w;
      if (el.nextSolat) el.nextSolat.textContent = `Solat seterusnya: ${s} (${formatTimeForNext(masaSeterusnya)})`;
      return { nama: s, masa: w };
    }
  }
  // Semua sudah lepas: guna Subuh esok (berdasarkan jadual hari ini)
  const subuhStr = waktuSolat.Subuh || "05:30";
  const esokSubuh = waktuToDate(subuhStr, 1);
  namaSolatSeterusnya = "Subuh"; masaSeterusnya = esokSubuh;
  if (el.nextSolat) el.nextSolat.textContent = `Solat seterusnya: ${namaSolatSeterusnya} (${formatTimeForNext(masaSeterusnya)})`;
  return { nama:namaSolatSeterusnya, masa:masaSeterusnya };
}
function formatTimeForNext(d) {
  if (!d || !(d instanceof Date)) return "";
  let h = d.getHours() % 12; 
  if (h === 0) h = 12;
  const m = pad(d.getMinutes());

  let mer = "Pagi"; // default
  if (d.getHours() >= 18) {
    mer = "Mlm";
  } else if (d.getHours() >= 12) {
    mer = "Ptg";
  } else {
    mer = "Pagi";
  }

  return `${pad(h)}:${m} ${mer}`;
}

/* ================== SOA: countdown solat akan masuk ================== */
let idSOA = null;
function mulaCountdownSOA() {
  if (idSOA) clearInterval(idSOA);
  idSOA = setInterval(()=> {
    if (!masaSeterusnya) return;
    const sekarang = new Date();
    const diff = Math.floor((masaSeterusnya - sekarang)/1000);

    // Jangan papar jika overlay lain sedang aktif
    const overlaysAktif = [el.slideMasuk, el.slideIqamah, el.slideSolat, el.slideKhutbah];
    if (overlaysAktif.some(n => n && n.classList.contains("show"))) {
      if (el.slideSoa) hideSlide(el.slideSoa);
      return;
    }

    if (diff>0 && diff<=SOA_WINDOW_SEC) {
      if (el.slideSoa) {
        el.slideSoa.textContent = `Waktu ${namaSolatSeterusnya} akan masuk dalam ${formatMasa(diff)}`;
        showSlide(el.slideSoa);
      }
    } else {
      if (el.slideSoa) hideSlide(el.slideSoa);
    }
  }, 1000);
}
function formatMasa(s) {
  const mm = String(Math.floor(s/60)).padStart(2,"0");
  const ss = String(s%60).padStart(2,"0");
  return `${mm}:${ss}`; 
}

/* ================== AZAN & IQAMAH ================== */
let azanSedang = false;
function mainkanAzan() {
  if (!el.azanAudio) return;
  if (azanSedang) return;
  azanSedang = true;
  try {
    el.azanAudio.currentTime = 0;
    const p = el.azanAudio.play();
    if (p && typeof p.then === 'function') {
      p.catch(()=> { azanSedang=false; });
    }
  } catch { azanSedang = false; }
  el.azanAudio.onended = () => { azanSedang = false; };
}

let idIqamah = null;
function mulaCountdownIqamah(nama, minit=null, callback=() => { paparSlideSolat(); }) {
  if (!el.slideIqamah) return;
  const mins = minit !== null ? parseInt(minit,10) : (IQAMAH_MAP[nama] || IQAMAH_DEFAULT_MIN);
  let masa = mins*60;
  showSlide(el.slideIqamah);
  const upd = ()=> {
    const mm = String(Math.floor(masa/60)).padStart(2,"0");
    const ss = String(masa%60).padStart(2,"0");
    if (el.slideIqamahCounter) el.slideIqamahCounter.textContent = `${mm}:${ss}`;
  };
  upd();
  if (idIqamah) clearInterval(idIqamah);
  idIqamah = setInterval(()=> {
    masa--;
    if (masa<=0) {
      clearInterval(idIqamah);
      hideSlide(el.slideIqamah);
      callback();
    } else upd();
  }, 1000);
}

/* show solat slide and refresh schedule after solat window ends */
function paparSlideSolat() {
  if (!el.slideSolat) return;
  showSlide(el.slideSolat, SOLAT_SLIDE_DURATION_MS);
  // after solat period ends, re-fetch schedule and recalc
  setTimeout(()=> { ambilWaktuSolatHarian().catch(()=>{}); }, SOLAT_SLIDE_DURATION_MS + 500);
}

/* ================== SLIDE KHUTBAH ================== */

function startKhutbahJumaat() {
  const today = new Date();
  if (today.getDay() !== 5) return;
  if (!el.slideKhutbah) return;
  showSlide(el.slideKhutbah);
  setTimeout(()=> {
    hideSlide(el.slideKhutbah);
    startInfoKuliahTeksSequence();
  }, DURASI_KHUTBAH);
}
function selepasAzanSelesai(namaSolat) {
  const today = new Date();
  if (today.getDay()===5 && namaSolat==="Zohor") {
    startKhutbahJumaat();
  } else {
    mulaCountdownIqamah();
  }
}

/* ================== PANTAU MASUK WAKTU ================== */
function semakMasukWaktu() {
  const solatUtama = ["Subuh","Zohor","Asar","Maghrib","Isyak"]; 
  setInterval(()=> {
    const now = new Date();
    for (const nama of solatUtama) {
      const str = waktuSolat[nama];
      if (!str) continue;
      const wDate = waktuToDate(str);
      const deltaMs = now - wDate; 
      const withinWindow = deltaMs >= 0 && deltaMs <= SOLAT_LEWAY_SEC*1000;
      const notYetTriggered = lastTriggered.nama !== nama || lastTriggered.stamp < wDate.getTime();
      if (withinWindow && notYetTriggered) {
        lastTriggered = { nama, stamp: wDate.getTime() };
        if (el.masukNama) el.masukNama.textContent = nama;
        if (el.slideMasuk) showSlide(el.slideMasuk, 5000);
        
        mainkanAzan();
        
        // >>>> GUNA HOOK YANG BETUL <<<<
        setTimeout(()=> { selepasAzanSelesai(nama); }, 5000);
        
        setTimeout(()=> { kiraNextSolat(); }, 2000);
        break;
      }
    }
  }, 500);
}

/* ================== DATA: KULIAH (Google Sheet) ================== */
async function fetchKuliahData() {
  try {
    const resp = await fetch(GOOGLE_SHEET_API_URL_KULIAH + "?t=" + Date.now());
    if (!resp.ok) throw new Error("fetch failed");
    const data = await resp.json();
    if (!Array.isArray(data)) { console.warn("sheet returned not an array", data); senaraiKuliah = []; return; }

    // Normalize & filter
    senaraiKuliah = data.map(row => {
      const obj = {};
      for (const k in row) {
        const key = k.trim().toLowerCase();
        obj[key] = row[k];
      }
      // alias / normalisasi
      obj.gambar = cleanImageUrl(obj.gambar || obj.image || obj.photo || "");
      // tarikh -> Date
      if (obj.tarikh) {
        const d = new Date(obj.tarikh);
        if (!isNaN(d)) obj._tarikhObj = d;
      }
      return obj;
    });

    // Filter papar + buang tarikh lepas
    senaraiKuliah = senaraiKuliah.filter(it => {
      const keys = Object.keys(it);
      const kPapar = keys.find(k => ["papar","show","aktif","tunjuk","display"].includes(k));
      if (kPapar) {
        const v = String(it[kPapar]).toLowerCase();
        if (!["true","1","yes","y"].includes(v)) return false;
      }
      if (it._tarikhObj) {
        const t = new Date(it._tarikhObj); t.setHours(0,0,0,0);
        const today = new Date(); today.setHours(0,0,0,0);
        if (t < today) return false;
      }
      return true;
    });

    // Sort tarikh menaik
    senaraiKuliah.sort((a,b) => {
      const da = a._tarikhObj ? a._tarikhObj.getTime() : Infinity;
      const db = b._tarikhObj ? b._tarikhObj.getTime() : Infinity;
      return da - db;
    });

    console.log("Kuliah loaded:", senaraiKuliah.length);
  } catch (err) {
    console.warn("fetchKuliahData error:", err);
    senaraiKuliah = [];
  }
}

/* ================== DATA: SLIDE INFO IMG (Google Sheet) ================== */
async function fetchInfoImgData() {
  try {
    const resp = await fetch(GOOGLE_SHEET_API_URL_INFOIMG + "?t=" + Date.now());
    if (!resp.ok) throw new Error("fetch failed");
    const data = await resp.json();
    if (!Array.isArray(data)) { console.warn("infoimg sheet not array", data); senaraiInfoImg = []; return; }

    // Normalise kunci -> lowercase
    const rows = data.map(row => {
      const obj = {};
      for (const k in row) obj[k.trim().toLowerCase()] = row[k];
      return obj;
    });

    // Ambil yang papar === true dan ada slaidpng
    senaraiInfoImg = rows
      .filter(r => {
        const papar = String(r.papar).toLowerCase();
        const on = ["true","1","yes","y"].includes(papar);
        return on && r.slaidpng;
      })
      .map(r => ({ url: cleanImageUrl(r.slaidpng) }));

    console.log("InfoIMG loaded:", senaraiInfoImg.length);
  } catch (err) {
    console.warn("fetchInfoImgData error:", err);
    senaraiInfoImg = [];
  }
}

/* ================== PAPARAN: SLIDE INFO IMG objectFit auto-switch================== */
function setImageFit(imgElement) {
  imgElement.onload = function () {
    if (imgElement.naturalWidth > imgElement.naturalHeight) {
      imgElement.style.objectFit = "cover";   // landskap
    } else {
      imgElement.style.objectFit = "contain"; // potret
    }
  };
}

/* ================== PAPARAN: SLIDE INFO IMG ================== */
async function showInfoImagesSequence() {
  // Jangan ganggu jika overlay penting aktif
  const overlays = [el.slideMasuk, el.slideIqamah, el.slideSolat, el.slideKhutbah, el.slideSoa];
  if (overlays.some(n => n && n.classList.contains("show"))) return;

  // Pilih sumber: Google Sheet (utama) atau fallback lokal
  const list = (senaraiInfoImg && senaraiInfoImg.length>0)
    ? senaraiInfoImg.map(x => x.url)
    : INFO_IMAGES_FALLBACK;

  for (let i=0; i<list.length; i++) {
    if (!el.slideInfo || !el.slideInfoImg) break;
    if (overlays.some(n => n && n.classList.contains("show"))) break;

    const url = list[i];
    const ok = await preloadImage(url);
    el.slideInfoImg.src = ok ? url : ""; // kalau 404, skip paparan

    if (ok) {
      showSlide(el.slideInfo);
      await new Promise(res => setTimeout(res, INFO_IMAGE_DURATION_MS));
      hideSlide(el.slideInfo);
      await new Promise(res => setTimeout(res, 400));
    }
  }
}

/* ================== PAPARAN: SLIDE KULIAH ================== */
async function showKuliahSequence() {
  if (!el.slideKuliah) return;
  if (!senaraiKuliah || senaraiKuliah.length===0) return;

  for (const it of senaraiKuliah) {
    const overlays = [el.slideMasuk, el.slideIqamah, el.slideSolat, el.slideKhutbah, el.slideSoa];
    if (overlays.some(n => n && n.classList.contains("show"))) break;

    // Gambar
    if (el.kuliahEls.gambar) {
      const url = it.gambar || "img/penceramah-default.png";
      const ok = await preloadImage(url);
      el.kuliahEls.gambar.src = ok ? url : "img/penceramah-default.png";
      el.kuliahEls.gambar.alt = it.penceramah || "Penceramah";
    }

    // Teks
    if (el.kuliahEls.nama)      el.kuliahEls.nama.textContent      = it.nama || "";
    if (el.kuliahEls.tajuk)     el.kuliahEls.tajuk.textContent     = it.tajuk || "";
    if (el.kuliahEls.penceramah)el.kuliahEls.penceramah.textContent= it.penceramah || "";
    if (el.kuliahEls.jawatan)   el.kuliahEls.jawatan.textContent   = it.jawatan || "";
    if (el.kuliahEls.masa)      el.kuliahEls.masa.textContent      = it.masa || "";
    if (el.kuliahEls.lokasi)    el.kuliahEls.lokasi.textContent    = it.lokasi || "";

    if (el.kuliahEls.tarikh) {
      if (it._tarikhObj) {
        const d = it._tarikhObj;
        const hari = d.toLocaleDateString('ms-MY',{weekday:'long'});
        const tarikhNum = d.getDate();
        const bulan = d.toLocaleDateString('ms-MY',{month:'long'});
        const tahun = d.getFullYear();
        el.kuliahEls.tarikh.textContent = `${hari}, ${tarikhNum} ${bulan} ${tahun}`;
      } else {
        el.kuliahEls.tarikh.textContent = it.tarikh || "";
      }
    }

    showSlide(el.slideKuliah);
    await new Promise(res => setTimeout(res, KULIAH_ITEM_DURATION_MS));
    hideSlide(el.slideKuliah);
    await new Promise(res => setTimeout(res, 400));
  }
}

/* ================== TEKS BAWAH ================== */
async function fetchTeksBawah() {
  try {
    const res = await fetch(API_TEKS_BAWAH + "?t=" + Date.now());
    const data = await res.json();
    // data dijangka array of objek { tajuk, teks/p1..p5, papar }
    window.listTeksBawah = (Array.isArray(data) ? data : [])
      .filter(item => String(item.papar).toUpperCase() === "TRUE");
    console.log("[TeksBawah] Dapat data:", window.listTeksBawah);
  } catch (e) {
    console.warn("[TeksBawah] Gagal fetch API, guna fallback");
    window.listTeksBawah = [
      { tajuk:"Pengumuman", p1:"Gotong Royong Kebersihan & Kecerian Masjid", p2:"Hari Ahad Minggu Pertama Setiap Bulan" },
      { tajuk:"Pengumuman", p1:"Gotong Royong di Kubur", p2:"Hari Ahad Minggu Ke-3 Setiap Bulan" },
      { tajuk:"Program", p1:"Kuliah Muslimat setiap Khamis jam 3 petang" },
      { tajuk:"Infak", p1:"Sumbangan boleh dibuat melalui tabung & QRPay" }
    ];
  }
}

function _binaMarkupTeks(item) {
  let html = "";
  if (item.tajuk) html += `<div class="perenggan tajuk">${item.tajuk}</div>`;
  if (item.p1)    html += `<div class="perenggan">${item.p1}</div>`;
  if (item.p2)    html += `<div class="perenggan">${item.p2}</div>`;
  if (item.p3)    html += `<div class="perenggan">${item.p3}</div>`;
  if (item.p4)    html += `<div class="perenggan">${item.p4}</div>`;
  if (item.p5)    html += `<div class="perenggan">${item.p5}</div>`;
  return html;
}

/** ================== PAPAR TEKS BAWAH ================== */
const SYNC_LATAR_MODE = "batch"; 
// "item" = tukar latar setiap teks
// "batch" = tukar latar selepas batch selesai

/** Papar SATU item teks bawah dengan animasi scroll + pause */
function paparTeksBawah(doneCallback) {
  const container = document.querySelector(".scroll-container");
  const wrapper   = document.getElementById("paparan-teks-bawah");
  if (!container || !wrapper) { 
    console.warn("[TeksBawah] Elemen tidak jumpa"); 
    if (doneCallback) doneCallback(); 
    return; 
  }

  // Kosongkan isi lama
  wrapper.innerHTML = "";
  if (!window.listTeksBawah || window.listTeksBawah.length === 0) { 
    if (doneCallback) doneCallback(); 
    return; 
  }

  // Pilih item ikut giliran
  const item = window.listTeksBawah.shift();
  window.listTeksBawah.push(item);

  // Bina markup teks
  wrapper.innerHTML = _binaMarkupTeks(item);

  // Reset posisi (mula dari bawah)
  wrapper.style.transition = "none";
  wrapper.style.transform  = `translateY(${container.offsetHeight}px)`;
  void wrapper.offsetHeight; // reflow

  const speed = 40; // px/s
  const masukDistance = container.offsetHeight;
  const keluarDistance = wrapper.offsetHeight;
  const masukDuration = masukDistance / speed;
  const keluarDuration = keluarDistance / speed;
  const pauseDuration = Math.max(2, wrapper.offsetHeight / 40);

  // simpan tempoh untuk sync latar
  window.lastTempohTeks = masukDuration + pauseDuration + keluarDuration;

  // === Fasa 1: scroll masuk ===
  setTimeout(() => {
    wrapper.style.transition = `transform ${masukDuration}s linear`;
    wrapper.style.transform  = `translateY(0)`;
  }, 100);

  // === Pause ===
  setTimeout(() => {
    wrapper.style.transition = `transform ${keluarDuration}s linear`;
    wrapper.style.transform  = `translateY(-${wrapper.offsetHeight}px)`;
  }, (masukDuration + pauseDuration) * 1000);

  // === Tamat ===
  setTimeout(() => { 
    if (doneCallback) doneCallback(); 
    // mode per-item → tukar setiap kali teks tamat
    if (SYNC_LATAR_MODE === "item") tukarLatar();
  }, (masukDuration + pauseDuration + keluarDuration) * 1000);
}

/** Papar N item berturut sebelum tamat cycle */
async function paparTeksBawahBatch(n=TEKS_ITEMS_PER_CYCLE) {
  const jumlah = Math.max(1, n);
  for (let i=0; i<jumlah; i++) {
    await new Promise(res => paparTeksBawah(res));
  }
  // mode batch → tukar sekali sahaja lepas semua teks tayang
  if (SYNC_LATAR_MODE === "batch") tukarLatar();
}

/** ================== LATAR BELAKANG OTOMATIK ================== */
let senaraiGambar = [];
let indeksGambar = 0;
let timerLatar = null;

function getTempohTukarLatar() {
  return window.lastTempohTeks ? window.lastTempohTeks * 1000 : 20000; 
}

function ambilGambarDariAPI() {
  fetch("https://script.google.com/macros/s/AKfycbxJ_mxOPHFwZkkBsnWg3BPkb6_K9u83CllpH0PxKmiYP2jm70P-vqQyzbLQfpfUNRgeeA/exec")
    .then(res => res.json())
    .then(data => {
      if (Array.isArray(data)) {
        senaraiGambar = data
          .filter(item => (item.papar === true || String(item.papar).toUpperCase() === "TRUE") && item.latarBelakangPNG)
          .map(item => cleanImageUrl(item.latarBelakangPNG));
        if (senaraiGambar.length > 0) mulaTukarLatar();
      }
    })
    .catch(err => console.error("Gagal ambil gambar latar:", err));
}

function mulaTukarLatar() {
  if (timerLatar) clearTimeout(timerLatar);
  function loop() {
    tukarLatar();
    timerLatar = setTimeout(loop, getTempohTukarLatar());
  }
  loop();
}

function tukarLatar() {
  if (!senaraiGambar.length) return;
  const url = senaraiGambar[indeksGambar];
  document.body.style.backgroundImage = `url('${url}')`;
  document.body.style.backgroundSize = 'cover';
  document.body.style.backgroundPosition = 'center';
  document.body.style.backgroundRepeat = 'no-repeat';
  indeksGambar = (indeksGambar + 1) % senaraiGambar.length;
}

// Panggil semasa load
ambilGambarDariAPI();

/** ================== SIRI: INFO → KULIAH → TEKS ================== */
let _sequenceRunning = false;
async function startInfoKuliahTeksSequence() {
  if (_sequenceRunning) return;
  _sequenceRunning = true;
  console.log("=== Mula kitaran Info → Kuliah → Teks ===");

  const tStart = Date.now();

  async function waitForNoOverlay() {
    const overlays = [el.slideMasuk, el.slideIqamah, el.slideSolat, el.slideKhutbah, el.slideSoa];
    while (overlays.some(n => n && n.classList.contains("show"))) {
      console.log("[Sequence] Overlay aktif, tunggu 2s...");
      await new Promise(res => setTimeout(res, 2000));
    }
  }
  await waitForNoOverlay();

  await showInfoImagesSequence();
  await showKuliahSequence();
  await paparTeksBawahBatch(TEKS_ITEMS_PER_CYCLE);

  const took = Date.now() - tStart;
  const waitMore = Math.max(500, INFO_CYCLE_INTERVAL_MS - took);
  _sequenceRunning = false;
  setTimeout(startInfoKuliahTeksSequence, waitMore);
}

/* ================== TEMA MALAM ================== */
function cekTemaMalam(){
  const jamNow = new Date().getHours();
  if (jamNow >= 19 || jamNow < 6) document.body.classList.add("dark-mode");
  else document.body.classList.remove("dark-mode");
}

/* ================== INIT ================== */
async function init() {
  // UI start
  paparkanTarikhGregorian();
  paparkanJamDigital();
  paparkanTarikhHijri();

  if (el.slideInfoImg) setImageFit(el.slideInfoImg);

  cekTemaMalam();
  setInterval(cekTemaMalam, 30*1000);

  // Zon dropdown (jika ada)
  if (el.zonSelect) {
    el.zonSelect.value = zon;
    el.zonSelect.addEventListener("change", () => {
      zon = el.zonSelect.value;
      localStorage.setItem("zon", zon);
      ambilWaktuSolatHarian().catch(()=>{});
    });
  }

  // Jadual solat
  await ambilWaktuSolatHarian();
  semakMasukWaktu();
  mulaCountdownSOA();

  // Data dari Google Sheet
  await Promise.all([
    fetchKuliahData(),
    fetchTeksBawah(),
    fetchInfoImgData()
  ]);

  // Refresh berkala
  setInterval(fetchKuliahData, KULIAH_FETCH_INTERVAL_MS);
  setInterval(fetchInfoImgData, INFO_FETCH_INTERVAL_MS);
  setInterval(fetchTeksBawah, TEKS_BAWAH_FETCH_INTERVAL_MS);

  // refresh hijri occasionally
  setInterval(paparkanTarikhHijri, 60*1000);

  // Mula kitaran info→kuliah→teks
  startInfoKuliahTeksSequence();
}

/* start when DOM ready */
document.addEventListener("DOMContentLoaded", ()=> {
  init().catch(err => console.error("init error", err));
});

/* ============== Exports untuk debug (optional) ============== */
window._tvmasjid = {
  ambilWaktuSolatHarian, paparkanWaktuSolat, kiraNextSolat,
  mulaCountdownSOA, mainkanAzan, mulaCountdownIqamah,
  fetchKuliahData, fetchInfoImgData, fetchTeksBawah,
  showKuliahSequence, showInfoImagesSequence, paparTeksBawahBatch,
  startInfoKuliahTeksSequence
};
