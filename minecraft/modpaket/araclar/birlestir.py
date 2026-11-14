#!/usr/bin/env python3
"""secim.json + ek modlar - çıkarılacaklar => paket.json (NeoForge 1.21.1 son mod listesi)."""
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')
MC, LOADER = '1.21.1', 'NeoForge'

# Sodium ile çakışan Embeddium ailesi
CIKAR = {'Embeddium', 'Embeddium (Rubidium) Extra',
         'No Chat Restrictions',  # 1.21.1 dosyası yok (yalnızca 1.21.11 etiketi yanlış)
         'Let Me Despawn'}        # 1.21.1 sürümü CurseForge'da olmayan "dungeonconfig" kütüphanesini istiyor

# NeoForge karşılıkları ve yeni gerekenler (CurseForge proje kimlikleri)
EK = {
    1015100: "YUNG's API (NeoForge)", 1015112: "YUNG's Better Dungeons (NeoForge)", 1015149: "YUNG's Bridges (NeoForge)",
    1015096: "YUNG's Better Mineshafts (NeoForge)", 1015105: "YUNG's Better Strongholds (NeoForge)", 1015146: "YUNG's Extras (NeoForge)",
    1015157: 'Paxi (NeoForge)', 525480: 'Better Villages - NeoForge', 522351: 'Library Ferret - NeoForge',
    394468: 'Sodium', 511319: "Reese's Sodium Options", 455508: 'Iris Shaders',
    1688065: 'Valkyrien Skies 2.0 (Unofficial)', 1691430: 'Eureka! 2.0 (Unofficial)', 351264: 'Kotlin for Forge',
}


def pick(d):
    import re
    c = [f for f in d.get('files', []) if MC in f['versions'] and LOADER in f['versions']]
    c = [f for f in c if not re.search(r'1\.21\.(?!1(?!\d))\d+', f['name'])] or c
    rank = {'release': 0, 'beta': 1, 'alpha': 2}
    best = min(rank.get(f.get('type'), 3) for f in c)
    return max([f for f in c if rank.get(f.get('type'), 3) == best], key=lambda f: f['uploaded_at'])


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else '.'
    secim = json.load(open(os.path.join(base, 'secim.json'), encoding='utf-8'))
    out = [dict(s, kaynak='paket') for s in secim if s['ad'] not in CIKAR]
    have = {s['projectID'] for s in out}
    ekp = os.path.join(base, 'ek_bagimlilik.json')
    if os.path.exists(ekp):                              # bagimlilik.py ile bulunan kütüphaneler
        for k, v in json.load(open(ekp, encoding='utf-8')).items():
            EK.setdefault(int(k), v)
    for pid, ad in EK.items():
        if pid in have:
            continue
        d = json.load(open(os.path.join(base, 'onbellek', f'{pid}.json'), encoding='utf-8'))
        f = pick(d)
        out.append({'projectID': pid, 'ad': d['title'], 'tur': d.get('type', ''), 'url': d['urls']['curseforge'], 'fileID': f['id'],
                    'dosya': f['name'], 'surum_turu': f.get('type'), 'ortam': [v for v in f['versions'] if v in ('Client', 'Server')],
                    'boyut': f.get('filesize', 0), 'tarih': f['uploaded_at'][:10], 'kaynak': 'ek'})
    json.dump(out, open(os.path.join(base, 'paket.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('toplam mod:', len(out), '| ek:', sum(1 for x in out if x['kaynak'] == 'ek'),
          '| yalnızca istemci:', sum(1 for x in out if x['ortam'] == ['Client']),
          '| toplam boyut MB:', round(sum(x['boyut'] for x in out) / 1e6))


if __name__ == '__main__':
    main()
