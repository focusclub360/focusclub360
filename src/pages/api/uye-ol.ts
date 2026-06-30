import type { APIRoute } from 'astro';

// Bu rota statik değil; Vercel serverless fonksiyonu olarak çalışır.
export const prerender = false;

// Üyelik formundan beklenen zorunlu alanlar (form alan adlarıyla birebir).
const ZORUNLU_ALANLAR = [
  'Veli Adı',
  'Veli Soyadı',
  'Veli Yakınlık Derecesi',
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

// Ortam değişkenleri (Vercel → Settings → Environment Variables)
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_API_BASE = process.env.RESEND_API_BASE || 'https://api.resend.com';
const SHEETS_WEBHOOK_URL = process.env.SHEETS_WEBHOOK_URL;
const FROM_EMAIL = process.env.FROM_EMAIL || 'FocusClub 360 <info@focusclub360.com>';
const INFO_EMAIL = process.env.INFO_EMAIL || 'info@focusclub360.com';
const INSTAGRAM_URL = 'https://instagram.com/focusclub360';
// Mail logosu mutlak bir URL olmalı. Alan adı henüz canlı değilse LOGO_URL env'i ile
// yayında olan bir adrese (ör. vercel.app) ayarlanabilir.
const SITE_URL = (process.env.SITE_URL || 'https://focusclub360.com').replace(/\/$/, '');
const LOGO_URL = process.env.LOGO_URL || `${SITE_URL}/FocusClub360_logoF_navy.png`;

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

  // Kayıt + mailleri paralel dene; biri başarısız olsa bile diğeri çalışsın.
  const sonuclar = await Promise.allSettled([tabloyaKaydet(kayit), mailleriGonder(kayit)]);
  sonuclar.forEach((s) => {
    if (s.status === 'rejected') console.error('uye-ol işleme hatası:', s.reason);
  });

  return jsonYanit({ success: true });
};

// ============================ Google Sheet ============================
// Apps Script Web App'e (SHEETS_WEBHOOK_URL) bir satır olarak POST eder.
async function tabloyaKaydet(kayit: Record<string, string>): Promise<void> {
  if (!SHEETS_WEBHOOK_URL) {
    console.log('[tabloyaKaydet atlandı — SHEETS_WEBHOOK_URL yok]', kayit.Kod);
    return;
  }
  const res = await fetch(SHEETS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(kayit),
    redirect: 'follow',
  });
  const govde = await res.text().catch(() => '');
  console.log('[Sheets yanıt]', res.status, 'son-url:', res.url, 'govde:', govde.slice(0, 200));
  // Apps Script erişimi "Anyone" değilse Google giriş sayfasına yönlenir (HTML döner) → satır eklenmez.
  if (!res.ok || /<html|accounts\.google\.com|Sign in/i.test(govde)) {
    throw new Error(`Sheets webhook beklenmeyen yanıt (${res.status}). Apps Script erişimi "Anyone" mı, URL /exec ile mi bitiyor?`);
  }
}

// ============================ Resend mailleri ============================
async function mailleriGonder(kayit: Record<string, string>): Promise<void> {
  if (!RESEND_API_KEY) {
    console.log('[mailleriGonder atlandı — RESEND_API_KEY yok]', kayit.Kod, kayit['Veli E-posta']);
    return;
  }

  const mailler = [veliMaili(kayit), ogrenciMaili(kayit), infoMaili(kayit)].map((m) => ({
    from: FROM_EMAIL,
    to: [m.to],
    subject: m.subject,
    html: m.html,
  }));

  const res = await fetch(`${RESEND_API_BASE}/emails/batch`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(mailler),
  });
  if (!res.ok) {
    const metin = await res.text().catch(() => '');
    throw new Error(`Resend hata: ${res.status} ${metin}`);
  }
}

// ============================ Mail şablonları ============================
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mailKabuk(govde: string): string {
  return `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0E1124;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0E1124;padding:28px 14px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#161A33;border-radius:12px;overflow:hidden;">
        <tr><td style="background-color:#3D4AC8;background:linear-gradient(90deg,#2D3AAE,#6E7CFF);padding:20px 28px;">
          <img src="${LOGO_URL}" alt="FocusClub 360" height="32" style="height:32px;width:auto;display:block;border:0;outline:none;text-decoration:none;" />
        </td></tr>
        <tr><td style="padding:28px;color:#C7CEEF;font-size:15px;line-height:1.6;">
          ${govde}
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #2A3060;color:#7E89BF;font-size:12px;line-height:1.6;">
          FocusClub 360 &middot; <a href="mailto:${INFO_EMAIL}" style="color:#8B9BFF;text-decoration:none;">${INFO_EMAIL}</a><br>
          Türkiye'nin İlk ve Tek Dijital Akademik Etüt Kulübü
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function kodKutusu(kod: string): string {
  return `<div style="margin:22px 0;padding:18px;text-align:center;background:#0E1124;border:1px dashed #6E7CFF;border-radius:10px;">
    <div style="font-size:12px;color:#8B9BFF;letter-spacing:1px;text-transform:uppercase;">Deneyim Kodunuz</div>
    <div style="margin-top:6px;font-size:26px;font-weight:bold;color:#ffffff;letter-spacing:2px;">${esc(kod)}</div>
  </div>`;
}

function veliMaili(k: Record<string, string>) {
  const govde = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:17px;font-weight:bold;">Sayın ${esc(k['Veli Adı'])} ${esc(k['Veli Soyadı'])},</p>
    <p style="margin:0 0 8px;">FocusClub 360 ailesine hoş geldiniz. ${esc(k['Öğrenci Adı'])} için <strong style="color:#ffffff;">2 Haftalık Ücretsiz Deneyim</strong> başvurunuz alındı.</p>
    ${kodKutusu(k.Kod)}
    <p style="margin:0 0 8px;">Deneyiminiz, ilk açılacak etüt grubuyla birlikte <strong style="color:#ffffff;">dönem başında</strong> başlayacaktır; başlangıç tarihini size ayrıca ileteceğiz.</p>
    <p style="margin:0 0 8px;">2 haftalık deneyim sonunda dilerseniz ücretli üyeliğe geçersiniz; karar tamamen sizindir. Deneyim için kredi kartı gerekmez.</p>
    <p style="margin:14px 0 0;">Sorularınız için <a href="mailto:${INFO_EMAIL}" style="color:#8B9BFF;text-decoration:none;">${INFO_EMAIL}</a> adresinden bize ulaşabilirsiniz.</p>`;
  return {
    to: k['Veli E-posta'],
    subject: 'FocusClub 360 | 2 Haftalık Ücretsiz Deneyim Kodunuz',
    html: mailKabuk(govde),
  };
}

function ogrenciMaili(k: Record<string, string>) {
  const govde = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:17px;font-weight:bold;">Merhaba ${esc(k['Öğrenci Adı'])},</p>
    <p style="margin:0 0 8px;">Aramıza hoş geldin! 2 haftalık ücretsiz deneyimin için kodun hazır:</p>
    ${kodKutusu(k.Kod)}
    <p style="margin:0 0 8px;">Deneyimin, ilk açılacak etüt grubuyla başlayacak. Canlı etütler, soru-cevap dersleri ve koçunla birlikte başarıya çok yakınsın. 🎯</p>
    <p style="margin:14px 0 0;">Bizi takip etmeyi unutma: <a href="${INSTAGRAM_URL}" style="color:#8B9BFF;text-decoration:none;">@focusclub360</a></p>`;
  return {
    to: k['Öğrenci E-posta'],
    subject: 'Deneyim Kodun Hazır! | FocusClub 360',
    html: mailKabuk(govde),
  };
}

function infoMaili(k: Record<string, string>) {
  const alanlar = [
    'Tarih', 'Kod',
    'Veli Adı', 'Veli Soyadı', 'Veli Yakınlık Derecesi', 'Veli Telefon', 'Veli E-posta',
    'Öğrenci Adı', 'Öğrenci Soyadı', 'Sınıf', 'Okul Adı', 'Öğrenci Telefon', 'Öğrenci E-posta',
    'Şehir', 'İlçe', 'Adres', 'Instagram Kullanıcı Adı',
    'KVKK Onayı', 'Üyelik Koşulları Onayı', 'Instagram Takip Onayı',
  ];
  const satirlar = alanlar
    .map(
      (a) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #2A3060;color:#8B9BFF;font-size:13px;white-space:nowrap;">${esc(a)}</td><td style="padding:6px 10px;border-bottom:1px solid #2A3060;color:#ffffff;font-size:13px;">${esc(k[a] || '-')}</td></tr>`
    )
    .join('');
  const govde = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:16px;font-weight:bold;">Yeni Üyelik Başvurusu</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${satirlar}</table>`;
  return {
    to: INFO_EMAIL,
    subject: `Yeni Üyelik Başvurusu | ${k['Öğrenci Adı']} ${k['Öğrenci Soyadı']} — ${k.Kod}`,
    html: mailKabuk(govde),
  };
}
