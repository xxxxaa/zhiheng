import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { BiometricAuth, AndroidBiometryStrength } from '@aparajita/capacitor-biometric-auth';

export const isNative = () => Capacitor.isNativePlatform();
let authenticating = false;
export async function nativeDeviceAvailable() {
  if (!isNative()) return false;
  const info = await BiometricAuth.checkBiometry();
  return info.deviceIsSecure;
}
export async function authenticateNative() {
  // The plugin's browser implementation is a simulator, never an authentication path.
  if (!isNative()) throw new Error('手机设备锁只能在安装后的 App 中使用');
  if (!await nativeDeviceAvailable()) throw new Error('请先在手机系统设置中开启锁屏密码');
  authenticating = true;
  try {
    await BiometricAuth.authenticate({
      reason: '解锁你的资产账本', cancelTitle: '取消', allowDeviceCredential: true,
      iosFallbackTitle: '使用设备口令', androidTitle: '解锁知衡',
      androidSubtitle: '验证身份后打开本机账本',
      androidBiometryStrength: AndroidBiometryStrength.strong,
      androidConfirmationRequired: true,
    });
  } finally { authenticating = false; }
}

export function onNativePause(lock: () => void) {
  if (!isNative()) return () => {};
  let disposed = false, pausedAt = 0;
  // A short system file picker/share dialog must be able to return its result.
  const handles = [
    App.addListener('pause', () => { if (!authenticating) pausedAt = Date.now(); }),
    App.addListener('resume', () => { if (pausedAt && Date.now() - pausedAt >= 60000) lock(); pausedAt = 0; }),
  ];
  handles.forEach(handle => { void handle.then(h => { if (disposed) void h.remove(); }).catch(() => lock()); });
  return () => { disposed = true; handles.forEach(handle => { void handle.then(h => h.remove()).catch(() => {}); }); };
}

export function onNativeBack(handle: () => boolean) {
  if (!isNative() || Capacitor.getPlatform() !== 'android') return () => {};
  let disposed = false;
  const listener = App.addListener('backButton', () => { if (!handle()) void App.minimizeApp(); });
  void listener.then(h => { if (disposed) void h.remove(); });
  return () => { disposed = true; void listener.then(h => h.remove()); };
}
