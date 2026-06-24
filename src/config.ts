// Üyelik / kayıt akışı linkleri.
// TODO: Gerçek üyelik & giriş sayfası linki gelince yalnızca bu ikisini güncelle.
export const UYELIK_URL = '/uye-ol';
export const GIRIS_URL = '/giris';

// Alt sayfa rotaları (anasayfa tek sayfa akış; bu sayfalar ayrı olarak yapılacak).
export const ROUTES = {
  kulupteNelerVar: '/kulupte-neler-var',
  nasilCalisir: '/nasil-calisir',
  velilere: '/velilere',
  nasilUyeOlunur: '/nasil-uye-olunur',
  rehber: '/rehber',
  merakEdilenler: '/merak-edilenler',
};

// Anasayfa içi (one-page) bölüm çapaları. Baştaki "/" alt sayfalardan da çalışmasını sağlar.
export const ANCHORS = {
  sss: '/#sss',
  iletisim: '/#iletisim',
};
