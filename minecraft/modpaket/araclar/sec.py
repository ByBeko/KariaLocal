#!/usr/bin/env python3
"""
Claws of Berk manifest'indeki modlar için NeoForge 1.21.1 dosyası seçer.
Kullanım: python sec.py <eski_manifest.json> <cikti_klasoru>
Çıktı: secim.json (seçilen dosyalar), eksik.json (1.21.1 NeoForge dosyası olmayanlar), onbellek/<id>.json
"""
import json
import os
import sys
import time
import urllib.request

sys.stdout.reconfigure(encoding='utf-8')
MC, LOADER = '1.21.1', 'NeoForge'


def fetch(pid, cache):
    p = os.path.join(cache, f'{pid}.json')
    if os.path.exists(p):
        return json.load(open(p, encoding='utf-8'))
    for _ in range(3):
        try:
            req = urllib.request.Request(f'https://api.cfwidget.com/{pid}', headers={'User-Agent': 'karia-modpaket/1.0'})
            d = json.load(urllib.request.urlopen(req, timeout=30))
            if d.get('title'):
                json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False)
                return d
        except Exception:
            pass
        time.sleep(3)
    return {}


def pick(d):
    import re
    cands = [f for f in d.get('files', []) if MC in f.get('versions', []) and LOADER in f.get('versions', [])]
    # adında başka bir MC sürümü (1.21.11, 1.21.4 ...) geçen yanlış etiketli dosyaları ele
    ok = [f for f in cands if not re.search(r'1\.21\.(?!1(?!\d))\d+', f['name'])]
    cands = ok or cands
    if not cands:
        return None
    rank = {'release': 0, 'beta': 1, 'alpha': 2}
    cands.sort(key=lambda f: (rank.get(f.get('type'), 3), f.get('uploaded_at', '')), reverse=False)
    best_type = rank.get(cands[0].get('type'), 3)
    same = [f for f in cands if rank.get(f.get('type'), 3) == best_type]
    return max(same, key=lambda f: f.get('uploaded_at', ''))


def main():
    manifest, out = sys.argv[1], sys.argv[2]
    cache = os.path.join(out, 'onbellek')
    os.makedirs(cache, exist_ok=True)
    pids = [f['projectID'] for f in json.load(open(manifest, encoding='utf-8'))['files']]
    secim, eksik = [], []
    for pid in pids:
        d = fetch(pid, cache)
        f = pick(d)
        base = {'projectID': pid, 'ad': d.get('title', '?'), 'tur': d.get('type', ''), 'url': d.get('urls', {}).get('curseforge', '')}
        if f:
            env = [v for v in f['versions'] if v in ('Client', 'Server')]
            secim.append({**base, 'fileID': f['id'], 'dosya': f['name'], 'surum_turu': f.get('type'), 'ortam': env,
                          'boyut': f.get('filesize', 0), 'tarih': f.get('uploaded_at', '')[:10]})
        else:
            forge_only = any(MC in x.get('versions', []) and 'Forge' in x.get('versions', []) for x in d.get('files', []))
            eksik.append({**base, 'neden': 'yalnızca Forge 1.21.1' if forge_only else '1.21.1 yok'})
        time.sleep(0.3)
    json.dump(secim, open(os.path.join(out, 'secim.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump(eksik, open(os.path.join(out, 'eksik.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('seçilen', len(secim), 'eksik', len(eksik))
    for e in eksik:
        if e['neden'] != '1.21.1 yok':
            print('  ', e['ad'], '-', e['neden'])
    envs = {}
    for s in secim:
        k = '+'.join(s['ortam']) or 'belirsiz'
        envs[k] = envs.get(k, 0) + 1
    print('ortam dağılımı:', envs)


if __name__ == '__main__':
    main()
