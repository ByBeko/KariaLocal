#!/usr/bin/env python3
"""paket.json'daki modları CurseForge CDN'den indirir.
Kullanım: python indir.py <paket.json> <hedef_mods_klasoru> [sunucu|istemci]
sunucu: yalnızca istemciye özgü (ortam=['Client']) modları atlar."""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding='utf-8')


def url_for(fid, name):
    return f'https://mediafilez.forgecdn.net/files/{fid // 1000}/{fid % 1000}/{urllib.parse.quote(name)}'


def main():
    paket, dest, mode = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else 'sunucu')
    os.makedirs(dest, exist_ok=True)
    mods = json.load(open(paket, encoding='utf-8'))
    want = [m for m in mods if not (mode == 'sunucu' and m['ortam'] == ['Client'])]
    keep = {m['dosya'] for m in want}
    for f in os.listdir(dest):                       # listede olmayan eski jar'ları temizle
        if f.endswith('.jar') and f not in keep:
            os.remove(os.path.join(dest, f))
    bad = 0
    for m in want:
        p = os.path.join(dest, m['dosya'])
        if os.path.exists(p) and (not m['boyut'] or os.path.getsize(p) == m['boyut']):
            continue
        for _ in range(3):
            try:
                req = urllib.request.Request(url_for(m['fileID'], m['dosya']), headers={'User-Agent': 'karia-modpaket/1.0'})
                data = urllib.request.urlopen(req, timeout=120).read()
                if m['boyut'] and len(data) != m['boyut']:
                    raise IOError(f'boyut uyuşmuyor {len(data)} != {m["boyut"]}')
                open(p, 'wb').write(data)
                break
            except Exception as e:
                err = e
                time.sleep(3)
        else:
            bad += 1
            print('İNDİRİLEMEDİ:', m['ad'], m['dosya'], err)
    print(f'{mode}: {len(want)} mod, hata {bad}')


if __name__ == '__main__':
    main()
