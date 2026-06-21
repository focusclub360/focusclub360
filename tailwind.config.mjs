/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        beyaz: '#FFFFFF',
        bulut: '#F5F7FA',
        turkuaz: '#19C39C',
        mint: '#3DD9B8',
        amber: '#F5A524',
        mercan: '#F2683C',
        mor: '#7C5CFC',
        mavi: '#3B82F6',
        lacivert: '#0E1B2E',
        lacivert2: '#16273D',
        gri: '#64748B',
        kenar: '#E7ECF2',
      },
      fontFamily: {
        baslik: ['Poppins', 'sans-serif'],
        govde: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        kart: '8px',
        buton: '8px',
        cip: '8px',
        bant: '8px',
      },
      boxShadow: {
        yumusak: '0 18px 40px rgba(14,27,46,.08)',
        kucuk: '0 8px 20px rgba(14,27,46,.06)',
      },
      maxWidth: { icerik: '1200px' },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up .7s cubic-bezier(.16,1,.3,1) forwards',
      },
    },
  },
  plugins: [],
};
