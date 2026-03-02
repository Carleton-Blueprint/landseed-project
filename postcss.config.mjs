/**
 * PostCSS config: runs Tailwind and Autoprefixer on CSS. Used by Next.js when building styles.
 * @type {import('postcss-load-config').Config}
 */
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
