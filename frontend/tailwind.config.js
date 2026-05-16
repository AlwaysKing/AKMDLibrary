/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        notion: {
          bg: '#ffffff',
          text: '#37352f',
          textSecondary: '#9b9a97',
          sidebarBg: '#f9f8f7',
          sidebarText: '#5f5e59',
          sidebarSecHeader: '#91918e',
          hover: '#eeedec',
          border: '#e9e9e7',
          selection: '#d4ebfb',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', '-apple-system', 'system-ui', 'Segoe UI Variable Display', 'Segoe UI', 'Helvetica', 'PingFang SC', 'Microsoft YaHei', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
