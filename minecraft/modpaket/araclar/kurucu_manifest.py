#!/usr/bin/env python3
"""Karia Kurucu'nun okuduğu manifest.json'u üretir (karia.live/kurucu/manifest.json).
Kullanım: python kurucu_manifest.py <modpaket_klasoru> <cikti.json> <surum>"""
import json
import os
import sys
import urllib.parse

sys.stdout.reconfigure(encoding='utf-8')
NEOFORGE = '21.1.264'          # sunucudaki Arclight ile aynı
SHADERS = ['BSL Shaders', 'Solas Shader', 'AstraLex Shaders', 'Complementary Shaders - Unbound',
           'Complementary Shaders - Reimagined', 'Bliss Shaders']


def cdn(fid, name):
    return f'https://mediafilez.forgecdn.net/files/{fid // 1000}/{fid % 1000}/{urllib.parse.quote(name)}'


def main():
    base, out, ver = sys.argv[1], sys.argv[2], sys.argv[3]
    mods = json.load(open(os.path.join(base, 'paket.json'), encoding='utf-8'))
    eksik = json.load(open(os.path.join(base, 'eksik.json'), encoding='utf-8'))
    shaders = []
    for e in eksik:
        if e['ad'] not in SHADERS:
            continue
        d = json.load(open(os.path.join(base, 'onbellek', f"{e['projectID']}.json"), encoding='utf-8'))
        c = [f for f in d['files'] if '1.21.1' in f['versions'] and 'Iris' in f['versions']]
        if c:
            f = max(c, key=lambda f: f['uploaded_at'])
            shaders.append({'ad': e['ad'], 'dosya': f['name'], 'url': cdn(f['id'], f['name']), 'boyut': f.get('filesize', 0)})
    manifest = {
        'surum': ver,
        'minecraft': '1.21.1',
        'neoforge': NEOFORGE,
        'neoforge_kurucu': f'https://maven.neoforged.net/releases/net/neoforged/neoforge/{NEOFORGE}/neoforge-{NEOFORGE}-installer.jar',
        'sunucu': {'ad': 'Karia', 'adres': 'karia.live'},
        'profil': {'ad': 'Karia', 'klasor': 'karia', 'ram_mb': 6144},
        'modlar': [{'ad': m['ad'], 'dosya': m['dosya'], 'url': cdn(m['fileID'], m['dosya']), 'boyut': m['boyut']}
                   for m in sorted(mods, key=lambda m: m['ad'].lower())],
        'golgelendiriciler': shaders,
    }
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(manifest, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(out, '|', len(manifest['modlar']), 'mod,', len(shaders), 'gölgelendirici,',
          round(sum(m['boyut'] for m in manifest['modlar']) / 1e6), 'MB')


if __name__ == '__main__':
    main()
