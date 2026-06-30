import type { APIRoute } from 'astro';

// Bu rota statik değil; Vercel serverless fonksiyonu olarak çalışır.
export const prerender = false;

// Üyelik formundan beklenen zorunlu alanlar (form alan adlarıyla birebir).
const ZORUNLU_ALANLAR = [
  'Veli Adı',
  'Veli Soyadı',
  'Veli Telefon',
  'Veli E-posta',
  'Öğrenci Adı',
  'Öğrenci Soyadı',
  'Sınıf',
  'Okul Adı',
  'Öğrenci Telefon',
  'Öğrenci E-posta',
  'Şehir',
  'İlçe',
  'Adres',
  'Instagram Kullanıcı Adı',
];

const ONAY_ALANLARI = ['KVKK Onayı', 'Üyelik Koşulları Onayı', 'Instagram Takip Onayı'];

const EPOSTA_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Tahmin edilemez, okunabilir üyelik kodu: FC360-XXXXXX
function kodUret(): string {
  const harfler = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // karışabilen 0/O/1/I çıkarıldı
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let kod = '';
  for (const b of bytes) kod += harfler[b % harfler.length];
  return `FC360-${kod}`;
}

function jsonYanit(veri: unknown, status = 200): Response {
  return new Response(JSON.stringify(veri), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let data: Record<string, string>;
  try {
    data = await request.json();
  } catch {
    return jsonYanit({ success: false, message: 'Geçersiz istek.' }, 400);
  }

  // Honeypot (bot) — doluysa sessizce başarı taklidi yap, işleme alma.
  if (data.botcheck) {
    return jsonYanit({ success: true });
  }

  // Zorunlu alan kontrolü
  for (const alan of ZORUNLU_ALANLAR) {
    if (!data[alan] || String(data[alan]).trim() === '') {
      return jsonYanit({ success: false, message: `Lütfen "${alan}" alanını doldurun.` }, 400);
    }
  }

  // E-posta format kontrolü
  for (const alan of ['Veli E-posta', 'Öğrenci E-posta']) {
    if (!EPOSTA_RE.test(String(data[alan]).trim())) {
      return jsonYanit({ success: false, message: `Geçerli bir ${alan} girin.` }, 400);
    }
  }

  // Onaylar
  for (const alan of ONAY_ALANLARI) {
    if (!data[alan]) {
      return jsonYanit({ success: false, message: 'Lütfen gerekli onayları işaretleyin.' }, 400);
    }
  }

  const kod = kodUret();
  const kayit = { ...data, Kod: kod, Tarih: new Date().toISOString() };

  // --- TODO (sonraki adımlar): mail + tablo ---
  // Bu adımlar ilgili ortam değişkenleri (env) tanımlandığında devreye girer.
  try {
    await tabloyaKaydet(kayit); // Google Sheets / Airtable
    await mailleriGonder(kayit); // Resend: veli + öğrenci + info@
  } catch (err) {
    console.error('uye-ol işleme hatası:', err);
    // Kayıt/mail başarısız olsa bile kullanıcıyı engellememek için logla;
    // gerçek sistemde burada uygun hata yönetimi yapılacak.
  }

  return jsonYanit({ success: true });
};

// === Aşağıdakiler env tanımlanınca aktifleşir; şimdilik güvenli no-op ===

async function tabloyaKaydet(kayit: Record<string, string>): Promise<void> {
  // TODO: GOOGLE_SHEETS_ID + servis hesabı env'leri eklenince burada satır eklenecek.
  if (!import.meta.env.GOOGLE_SHEETS_ID) {
    console.log('[tabloyaKaydet atlandı — env yok]', kayit.Kod);
    return;
  }
  // ... Google Sheets API çağrısı buraya
}

async function mailleriGonder(kayit: Record<string, string>): Promise<void> {
  // TODO: RESEND_API_KEY eklenince veli/öğrenci/info@ maillerini gönder.
  if (!import.meta.env.RESEND_API_KEY) {
    console.log('[mailleriGonder atlandı — env yok]', kayit.Kod, kayit['Veli E-posta']);
    return;
  }
  // ... Resend API çağrıları buraya
}
