#!/usr/bin/env python3
"""Eksik mod kimliklerini (mod id) CurseForge projelerine çevirir ve ek_bagimlilik.json'a ekler.
Kullanım: python bagimlilik.py <modpaket_klasoru> <modid|cf-slug> ...
Önce cf slug olarak dener, olmazsa Modrinth aramasından slug alıp CurseForge'da arar."""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding='utf-8')
UA = {'User-Agent': 'karia-modpaket/1.0'}


def get(url):
    try:
        return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40))
    except Exception:
        return None


def cf(slug):
    d = get('https://api.cfwidget.com/minecraft/mc-mods/' + slug)
    return d if d and d.get('title') else None


def has_neo(d):
    return any('1.21.1' in f['versions'] and 'NeoForge' in f['versions'] for f in d.get('files', []))


def modrinth_slugs(q):
    facets = urllib.parse.quote(json.dumps([["versions:1.21.1"], ["categories:neoforge"]]))
    r = get(f'https://api.modrinth.com/v2/search?query={urllib.parse.quote(q)}&facets={facets}&limit=5')
    return [h['slug'] for h in (r or {}).get('hits', [])]


def main():
    base, ids = sys.argv[1], sys.argv[2:]
    path = os.path.join(base, 'ek_bagimlilik.json')
    ek = json.load(open(path, encoding='utf-8')) if os.path.exists(path) else {}
    for mid in ids:
        tries = [mid, mid.replace('_', '-'), mid.replace('_', '')]
        found = None
        for s in tries:
            d = cf(s)
            if d and has_neo(d):
                found = d
                break
        if not found:
            for s in modrinth_slugs(mid.replace('_', ' ')):
                d = cf(s)
                if d and has_neo(d):
                    found = d
                    break
                time.sleep(0.3)
        if found:
            ek[str(found['id'])] = found['title']
            json.dump(found, open(os.path.join(base, 'onbellek', f"{found['id']}.json"), 'w', encoding='utf-8'), ensure_ascii=False)
            print(f'{mid} -> {found["id"]} {found["title"]}')
        else:
            print(f'{mid} -> BULUNAMADI')
        time.sleep(0.4)
    json.dump(ek, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
