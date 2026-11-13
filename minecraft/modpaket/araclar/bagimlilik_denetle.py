#!/usr/bin/env python3
"""Bir mods klasöründeki jar'ların neoforge.mods.toml'larını okuyup eksik ZORUNLU bağımlılıkları listeler.
Kullanım: python bagimlilik_denetle.py <mods_klasoru> [client|server]"""
import os
import re
import sys
import zipfile

BUILTIN = {'minecraft', 'neoforge', 'forge', 'java', 'fml'}


def parse(text):
    mods, deps, cur = [], [], None
    for block in re.split(r'\n(?=\s*\[\[)', text):
        head = re.match(r'\s*\[\[\s*([^\]]+)\]\]', block)
        if not head:
            continue
        kind = head.group(1).strip()
        kv = dict(re.findall(r'^\s*([A-Za-z_]+)\s*=\s*["\']?([^"\'\n#]*)["\']?', block, re.M))
        if kind == 'mods':
            mods.append(kv.get('modId', '').strip())
        elif kind.startswith('dependencies'):
            owner = kind.split('.', 1)[1].strip() if '.' in kind else '?'
            deps.append((owner, kv.get('modId', '').strip(), kv.get('type', kv.get('mandatory', '')).strip().lower(),
                         kv.get('side', 'BOTH').strip().upper(), kv.get('versionRange', '').strip()))
    return mods, deps


def main():
    folder, side = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else 'client').upper()
    have, need = set(BUILTIN), []
    for f in sorted(os.listdir(folder)):
        if not f.endswith('.jar'):
            continue
        try:
            z = zipfile.ZipFile(os.path.join(folder, f))
        except zipfile.BadZipFile:
            continue
        for name in z.namelist():
            if name.endswith('neoforge.mods.toml') or name.endswith('mods.toml') and name.startswith('META-INF/'):
                mods, deps = parse(z.read(name).decode('utf-8', 'replace'))
                have.update(m for m in mods if m)
                for owner, mid, typ, s, vr in deps:
                    if typ in ('required', 'true') and s in ('BOTH', side):
                        need.append((f, owner, mid, vr))
        # jar-in-jar içindeki modlar da sayılır
        for name in z.namelist():
            if name.startswith('META-INF/jarjar/') and name.endswith('.jar'):
                try:
                    import io
                    inner = zipfile.ZipFile(io.BytesIO(z.read(name)))
                    for n2 in inner.namelist():
                        if n2.endswith('mods.toml'):
                            have.update(m for m in parse(inner.read(n2).decode('utf-8', 'replace'))[0] if m)
                except Exception:
                    pass
    missing = [(f, o, m, v) for f, o, m, v in need if m not in have]
    print(f'{len(have) - len(BUILTIN)} mod kimliği bulundu, {len(need)} zorunlu bağımlılık, {len(missing)} eksik ({side})')
    for f, o, m, v in missing:
        print(f'  EKSİK: {m} {v}  <- {o} ({f})')


if __name__ == '__main__':
    main()
