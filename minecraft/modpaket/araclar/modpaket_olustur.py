#!/usr/bin/env python3
"""
Oyuncular için CurseForge modpaketi (.zip) üretir: manifest.json (mod + gölgelendirici dosya kimlikleri) + modlist.html.
CurseForge uygulamasında: Oluştur > İçe aktar > bu zip.
Kullanım: python modpaket_olustur.py <modpaket_klasoru> <surum>
"""
import html
import json
import os
import sys
import zipfile

sys.stdout.reconfigure(encoding='utf-8')
NEOFORGE = '21.1.265'
# Eski paketteki gölgelendiriciler (Iris ile 1.21.1'de çalışır)
SHADERS = ['BSL Shaders', 'Solas Shader', 'AstraLex Shaders', 'Complementary Shaders - Unbound',
           'Complementary Shaders - Reimagined', 'Bliss Shaders']


def main():
    base, ver = sys.argv[1], sys.argv[2]
    mods = json.load(open(os.path.join(base, 'paket.json'), encoding='utf-8'))
    eksik = json.load(open(os.path.join(base, 'eksik.json'), encoding='utf-8'))
    files = [{'projectID': m['projectID'], 'fileID': m['fileID'], 'required': True} for m in mods]
    shader_rows = []
    for e in eksik:
        if e['ad'] not in SHADERS:
            continue
        d = json.load(open(os.path.join(base, 'onbellek', f"{e['projectID']}.json"), encoding='utf-8'))
        c = [f for f in d['files'] if '1.21.1' in f['versions'] and 'Iris' in f['versions']]
        if not c:
            continue
        f = max(c, key=lambda f: f['uploaded_at'])
        files.append({'projectID': e['projectID'], 'fileID': f['id'], 'required': True})
        shader_rows.append((e['ad'], f['name'], e['url']))
    manifest = {
        'minecraft': {'version': '1.21.1', 'modLoaders': [{'id': f'neoforge-{NEOFORGE}', 'primary': True}],
                      'recommendedRam': 6144},
        'manifestType': 'minecraftModpack', 'manifestVersion': 1,
        'name': 'Karia Berk', 'version': ver, 'author': 'Karia', 'files': files, 'overrides': 'overrides',
    }
    rows = ''.join(f'<li><a href="{html.escape(m["url"])}">{html.escape(m["ad"])}</a> — {html.escape(m["dosya"])}</li>' for m in
                   sorted(mods, key=lambda m: m['ad'].lower()))
    rows += ''.join(f'<li><a href="{html.escape(u)}">{html.escape(a)}</a> — {html.escape(n)} (gölgelendirici)</li>' for a, n, u in shader_rows)
    out_dir = os.path.join(base, 'dist')
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f'KariaBerk-1.21.1-{ver}.zip')
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
        z.writestr('modlist.html', f'<ul>\n{rows}\n</ul>')
        z.writestr('overrides/', '')
    print(out, '|', len(mods), 'mod +', len(shader_rows), 'gölgelendirici')


if __name__ == '__main__':
    main()
