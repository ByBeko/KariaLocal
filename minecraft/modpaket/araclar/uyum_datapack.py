#!/usr/bin/env python3
"""
Sunucu günlüğündeki "Unknown registry key" ganimet tablosu hatalarını okuyup, ilgili modun jar'ındaki tabloyu
eksik eşyaya atıf yapan girdiler çıkarılmış hâliyle bir veri paketine yazar (modun kendisine dokunmaz).
Kullanım: python uyum_datapack.py <sunucu_klasoru> <cikti_datapack_klasoru>
"""
import glob
import json
import os
import re
import sys
import zipfile

sys.stdout.reconfigure(encoding='utf-8')


def strip(node, missing):
    """Eksik eşyaya atıf yapan 'item' girdilerini ağaçtan çıkarır."""
    if isinstance(node, dict):
        if node.get('type') in ('minecraft:item',) and node.get('name') in missing:
            return None
        out = {}
        for k, v in node.items():
            nv = strip(v, missing)
            if nv is None and isinstance(v, dict) and v.get('name') in missing:
                continue
            out[k] = nv
        if isinstance(out.get('entries'), list):
            out['entries'] = [e for e in out['entries'] if e is not None]
        return out
    if isinstance(node, list):
        return [x for x in (strip(v, missing) for v in node) if x is not None]
    return node


def main():
    server, out = sys.argv[1], sys.argv[2]
    log = open(os.path.join(server, 'test.log'), encoding='utf-8', errors='replace').read()
    bad = {}
    for m in re.finditer(r'loot_table\]:([a-z0-9_]+):([a-z0-9_/]+) - (.*)', log):
        ns, path, msg = m.group(1), m.group(2), m.group(3)
        bad[(ns, path)] = set(re.findall(r'minecraft:item\]: ([a-z0-9_]+:[a-z0-9_]+)', msg))
    jars = glob.glob(os.path.join(server, 'mods', '*.jar'))
    os.makedirs(out, exist_ok=True)
    json.dump({'pack': {'pack_format': 48, 'description': 'Karia mod uyumluluk düzeltmeleri'}},
              open(os.path.join(out, 'pack.mcmeta'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    done = 0
    for (ns, path), missing in bad.items():
        entry = f'data/{ns}/loot_table/{path}.json'
        for j in jars:
            z = zipfile.ZipFile(j)
            if entry in z.namelist():
                table = json.loads(z.read(entry))
                fixed = strip(table, missing)
                dst = os.path.join(out, entry)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                json.dump(fixed, open(dst, 'w', encoding='utf-8'), indent=1)
                done += 1
                print(f'{ns}:{path} düzeltildi (çıkarılan: {", ".join(sorted(missing))})')
                break
        else:
            print(f'{ns}:{path} jar içinde bulunamadı')
    print('düzeltilen tablo:', done)


if __name__ == '__main__':
    main()
