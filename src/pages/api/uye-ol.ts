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
];

const ONAY_ALANLARI = ['KVKK Onayı', 'Üyelik Koşulları Onayı'];

const EPOSTA_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Ortam değişkenleri (Vercel → Settings → Environment Variables)
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_API_BASE = process.env.RESEND_API_BASE || 'https://api.resend.com';
const SHEETS_WEBHOOK_URL = process.env.SHEETS_WEBHOOK_URL;
const FROM_EMAIL = process.env.FROM_EMAIL || 'FocusClub 360 <info@focusclub360.com>';
const INFO_EMAIL = process.env.INFO_EMAIL || 'info@focusclub360.com';
// Mail logosu mutlak bir URL olmalı. Alan adı henüz canlı değilse LOGO_URL env'i ile
// yayında olan bir adrese (ör. vercel.app) ayarlanabilir.
const SITE_URL = (process.env.SITE_URL || 'https://focusclub360.com').replace(/\/$/, '');
const LOGO_URL = process.env.LOGO_URL || `${SITE_URL}/FocusClub360_logo_turuncu.png`;
// Beyaz zemini gomulu logo: Gmail koyu modu gorselleri ters cevirmedigi icin
// hem acik hem koyu modda turuncu 'o'lu logo dogru gorunur.
const MAIL_LOGO_URL = `${SITE_URL}/FocusClub360_logo_mail.png`;

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

  const mailler = [veliMaili(kayit), infoMaili(kayit)].map((m) => ({
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
  const ayrilLink = `mailto:${INFO_EMAIL}?subject=${encodeURIComponent('Üyelikten Ayrılma Talebi')}`;
  return `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"></head>
<body style="margin:0;padding:0;background:#FBF2EA;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF2EA;padding:28px 14px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #F0E2D5;">
        <!-- Logo: beyaz zemini gomulu (her iki modda dogru), turuncu 'o' -->
        <tr><td align="center" style="background:#ffffff;padding:22px 28px 16px;">
          <img src="${MAIL_LOGO_URL}" alt="FocusClub 360" height="56" style="height:56px;width:auto;display:block;border:0;outline:none;text-decoration:none;border-radius:8px;" />
        </td></tr>
        <!-- 3 Agustos bandi -->
        <tr><td align="center" style="background-color:#F1683C;background:linear-gradient(120deg,#F1683C,#FF9A5C);padding:13px 28px;">
          <span style="color:#ffffff;font-size:15px;font-weight:bold;">🎉 3 Ağustos 2026 &middot; Ücretsiz etütler başlıyor</span>
        </td></tr>
        <!-- Govde -->
        <tr><td style="padding:30px 28px;color:#5B6488;font-size:15px;line-height:1.65;">
          ${govde}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:20px 28px;border-top:1px solid #F0E2D5;color:#8A93B5;font-size:12px;line-height:1.7;">
          FocusClub 360 &middot; <a href="mailto:${INFO_EMAIL}" style="color:#F1683C;text-decoration:none;">${INFO_EMAIL}</a><br>
          Türkiye'nin İlk ve Tek Dijital Akademik Etüt Kulübü<br>
          <a href="${ayrilLink}" style="color:#8A93B5;text-decoration:underline;">Üyelikten ayrılmak için tıklayın</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function kodKutusu(kod: string): string {
  return `<div style="margin:24px 0;padding:20px;text-align:center;background:#FFF6EF;border:2px dashed #F1683C;border-radius:12px;">
    <div style="font-size:12px;color:#F1683C;letter-spacing:1px;text-transform:uppercase;font-weight:bold;">Deneyim Kodunuz</div>
    <div style="margin-top:8px;font-size:28px;font-weight:bold;color:#2A2F52;letter-spacing:3px;">${esc(kod)}</div>
  </div>`;
}

function veliMaili(k: Record<string, string>) {
  const govde = `
    <p style="margin:0 0 14px;color:#2A2F52;font-size:17px;font-weight:bold;">Sayın ${esc(k['Veli Adı'])} ${esc(k['Veli Soyadı'])},</p>
    <p style="margin:0 0 8px;">FocusClub 360 ailesine hoş geldiniz. ${esc(k['Öğrenci Adı'])} için <strong style="color:#2A2F52;">2 Haftalık Ücretsiz Deneyim</strong> başvurunuz alındı.</p>
    ${kodKutusu(k.Kod)}
    <p style="margin:0 0 8px;">Ücretsiz deneyiminiz <strong style="color:#2A2F52;">3 Ağustos 2026'da</strong> başlayan ilk etüt grubuyla başlar; detaylı programı e-posta ile paylaşacağız.</p>
    <p style="margin:0 0 8px;">2 haftalık deneyim sonunda dilerseniz ücretli üyeliğe geçersiniz; karar tamamen sizindir. Deneyim için kredi kartı gerekmez.</p>
    <p style="margin:14px 0 0;">Sorularınız için <a href="mailto:${INFO_EMAIL}" style="color:#F1683C;text-decoration:none;">${INFO_EMAIL}</a> adresinden bize ulaşabilirsiniz.</p>`;
  return {
    to: k['Veli E-posta'],
    subject: 'FocusClub 360 | 2 Haftalık Ücretsiz Deneyim Kodunuz',
    html: mailKabuk(govde),
  };
}

function infoMaili(k: Record<string, string>) {
  const alanlar = [
    'Tarih', 'Kod',
    'Veli Adı', 'Veli Soyadı', 'Veli Telefon', 'Veli E-posta',
    'Öğrenci Adı', 'Öğrenci Soyadı', 'Sınıf',
    'KVKK Onayı', 'Üyelik Koşulları Onayı',
  ];
  const satirlar = alanlar
    .map(
      (a) =>
        `<tr><td style="padding:7px 10px;border-bottom:1px solid #EEE2D6;color:#8A93B5;font-size:13px;white-space:nowrap;">${esc(a)}</td><td style="padding:7px 10px;border-bottom:1px solid #EEE2D6;color:#2A2F52;font-size:13px;font-weight:bold;">${esc(k[a] || '-')}</td></tr>`
    )
    .join('');
  const govde = `
    <p style="margin:0 0 14px;color:#2A2F52;font-size:16px;font-weight:bold;">Yeni Üyelik Başvurusu</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${satirlar}</table>`;
  return {
    to: INFO_EMAIL,
    subject: `Yeni Üyelik Başvurusu | ${k['Öğrenci Adı']} ${k['Öğrenci Soyadı']} — ${k.Kod}`,
    html: mailKabuk(govde),
  };
}
