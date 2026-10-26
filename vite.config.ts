import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { androidIconSvgPlugin } from './scripts/icon-svg-plugin.ts';
import { heicWorkerPlugin } from './scripts/heic-worker-plugin.ts';

// Tauri 2 使用 TAURI_ENV_PLATFORM，32 位 Android 目标还可能返回 androideabi。
const androidBuild = ['android', 'androideabi'].includes(process.env.TAURI_ENV_PLATFORM || process.env.TAURI_PLATFORM || '');

export default defineConfig({
  plugins: [vue(), androidIconSvgPlugin(), heicWorkerPlugin()],
  clearScreen: false,
  server: {
    host: process.env.TAURI_DEV_HOST || '127.0.0.1',
    port: 17520,
    strictPort: true,
    // Rust 编译产物由 Tauri 监听，避免 Vite 监听链接中的 DLL 导致 EBUSY 退出。
    watch: { ignored: ['**/src-tauri/**'] },
  },
  // 前端依赖仅从应用入口扫描，避免遍历 Rust 构建目录中的 HTML 文件。
  optimizeDeps: { entries: ['index.html'] },
  envPrefix: ['VITE_', 'TAURI_'],
  css: {
    // 动态视口单位无法静态转译，保留 vh 回退；支持 dvh 的新内核仍使用后面的原声明。
    postcss: { plugins: [{ postcssPlugin: 'viewport-unit-fallback', Declaration(declaration) { if (/\d(?:dvh|dvw)\b/.test(declaration.value)) declaration.cloneBefore({ value: declaration.value.replace(/(\d)d(v[hw])\b/g, '$1$2') }); } }] },
  },
  build: {
    // Tauri 会把整个 dist 嵌入可执行文件，必须清空旧的哈希资源，避免单文件持续膨胀。
    emptyOutDir: true,
    // Android 10 的系统 WebView 可以独立更新，构建按旧版 Chromium 语法生成。
    target: androidBuild ? 'chrome74' : process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    cssTarget: androidBuild ? 'chrome74' : undefined,
    minify: !process.env.TAURI_DEBUG ? 'oxc' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    // 当前桌面端将页面与 Font Awesome 资源合并为单一主包，允许其在 Tauri 单文件场景下保持完整。
    chunkSizeWarningLimit: 2500,
  },
});
