"""Package source and browser preview without local caches, credentials or signing files."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import tarfile
import zipfile

root = Path(__file__).resolve().parents[2]
artifacts = root / 'artifacts'
artifacts.mkdir(exist_ok=True)
excluded_dirs = {'node_modules', '.mobile-build', '.gradle', '.git', '.openai',
                 'Pods', 'DerivedData', 'xcuserdata', 'dist', '.idea', '__pycache__'}
excluded_suffixes = {'.keystore', '.jks', '.p12', '.mobileprovision', '.apk', '.aab', '.tsbuildinfo', '.xcuserstate'}
files = [root / 'README.md', root / '.gitignore']
for folder in ['docs', 'web']:
    for directory, dirs, names in os.walk(root / folder):
        relative = Path(directory).relative_to(root)
        dirs[:] = [d for d in dirs if d not in excluded_dirs and not (
            relative.parts[:2] in [('web', 'android'), ('web', 'ios')] and
            d in {'build', 'output', 'public', 'capacitor-cordova-android-plugins', 'capacitor-cordova-ios-plugins'})]
        for name in names:
            p = Path(directory) / name
            if name.startswith('.env') or name in {'.DS_Store', 'local.properties', 'google-services.json'} or p.suffix in excluded_suffixes:
                continue
            if p.is_file() and not p.is_symlink():
                files.append(p)

with zipfile.ZipFile(artifacts / 'zhiheng-mobile-source.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for p in sorted(files):
        archive.write(p, p.relative_to(root))
shutil.copy2(artifacts / 'zhiheng-mobile-source.zip', artifacts / 'zhiheng-source.zip')
with zipfile.ZipFile(artifacts / 'zhiheng-static.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for p in sorted((root / 'web/dist').rglob('*')):
        if p.is_file(): archive.write(p, p.relative_to(root / 'web/dist'))
with tarfile.open(artifacts / 'zhiheng-static.tar.gz', 'w:gz') as archive:
    for p in sorted((root / 'web/dist').rglob('*')):
        if p.is_file(): archive.add(p, arcname=p.relative_to(root / 'web/dist'))

with zipfile.ZipFile(artifacts / 'zhiheng-mobile-source.zip') as archive:
    names = archive.namelist()
    assert 'web/android/gradlew' in names and 'web/ios/App/App.xcodeproj/project.pbxproj' in names
    assert not any('node_modules/' in n or '.mobile-build/' in n or n.endswith('local.properties') for n in names)
    assert archive.testzip() is None
checksums = {p.name: {'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
             for p in sorted(artifacts.iterdir()) if p.suffix in {'.zip', '.apk', '.gz'}}
(artifacts / 'checksums.json').write_text(json.dumps(checksums, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(checksums, ensure_ascii=False, indent=2))
