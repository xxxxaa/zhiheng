import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { isNative } from './native';

const FileExport = registerPlugin<{saveFile(options: {name: string; data: string}): Promise<{saved: boolean}>}>('FileExport');

export async function download(text: string, name: string, type = 'application/json') {
  if (isNative()) {
    if (Capacitor.getPlatform() === 'android') {
      const result = await FileExport.saveFile({name: name.replace(/[\\/]/g, '_'), data: text});
      if (!result.saved) throw new Error('已取消保存文件');
      return;
    }
    const path = `exports/${crypto.randomUUID()}/${name.replace(/[\\/]/g, '_')}`;
    const file = await Filesystem.writeFile({ path, data: text, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
    // Keep the cache file available after share resolves: some receiving apps read it later.
    // It contains only the encrypted backup or the blank CSV template, never API credentials.
    await Share.share({ title: name, files: [file.uri], dialogTitle: '保存或分享文件' });
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
