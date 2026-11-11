/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // REQ-069：全站统一暖木色。
        // primary 与 index.css 的 --color-primary-* 令牌同一组（此前这里是从未被使用的蓝色）。
        primary: {
          50:  '#FAEEDA',
          100: '#FAC775',
          200: '#F5B755',
          300: '#EF9F27',
          400: '#D68A1B',
          500: '#BA7517',
          600: '#A5660F',
          700: '#854F0B',
          800: '#633806',
          900: '#412402',
        },
        // 把 Tailwind 的冷灰整组换成同明度的暖灰：全站 1500+ 处 gray-* 字面类一次变暖，
        // 每一档与原值明度相同（对比度不变）；200/300/400/500/800 恰好对应
        // index.css 里 --color-border / --color-border-strong / --color-text-hint / --color-text-muted / --color-text。
        gray: {
          50:  '#FBFAF7',
          100: '#F4F2EB',
          200: '#E5E2D9',
          300: '#D3D1C7',
          400: '#9A988F',
          500: '#6B6A64',
          600: '#55544E',
          700: '#403F3B',
          800: '#2C2C2A',
          900: '#1C1C1A',
        },
      },
    },
  },
  plugins: [],
}
