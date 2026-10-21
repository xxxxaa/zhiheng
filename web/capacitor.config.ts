import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.zhiheng.assets',
  appName: '知衡',
  webDir: 'dist',
  backgroundColor: '#f5f6f2',
  // All UI assets are bundled in the application; no remote website is loaded.
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false },
  ios: { contentInset: 'automatic', preferredContentMode: 'mobile' },
  plugins: { CapacitorHttp: { enabled: false }, SystemBars: { style: 'LIGHT', insetsHandling: 'native', initialViewportFitValueHint: 'cover' } },
};
export default config;
