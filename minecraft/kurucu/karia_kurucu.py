#!/usr/bin/env python3
"""
Karia Kurucu — Karia modlu sunucusu için tek tıklık kurulum.

Yaptıkları (resmi Minecraft Launcher'a):
  1. Java 21'i (Eclipse Temurin) yalnızca kurucunun kendi klasörüne indirir (SHA256 doğrulamalı).
  2. NeoForge'u resmi kurucusuyla kurar.
  3. Modları ve gölgelendiricileri %APPDATA%\\.minecraft\\karia klasörüne eşitler (fazla jar'ları mods_eski'ye taşır).
  4. Sunucu listesine karia.live'ı ekler, launcher'a "Karia" profilini ekler.
Hesap bilgilerine, girişe ya da launcher ayarlarının geri kalanına dokunmaz.
Mod listesi https://karia.live/kurucu/manifest.json adresinden okunur; tekrar çalıştırmak güncelleme yapar.
"""
import base64
import ctypes
import hashlib
import json
import os
import queue
import shutil
import struct
import subprocess
import sys
import threading
import time
import tkinter as tk
import urllib.request
import zipfile
from tkinter import messagebox, ttk

import ssl

try:  # Windows sertifika deposundaki eski/süresi dolmuş ara sertifikalar yerine güncel Mozilla kök listesi
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:  # noqa: BLE001
    SSL_CTX = ssl.create_default_context()
urllib.request.install_opener(urllib.request.build_opener(urllib.request.HTTPSHandler(context=SSL_CTX)))

MANIFEST_URL = 'https://karia.live/kurucu/manifest.json'
UA = {'User-Agent': 'KariaKurucu/1.0 (+https://karia.live)'}
APPDATA = os.environ.get('APPDATA', os.path.expanduser('~'))
LOCAL = os.environ.get('LOCALAPPDATA', APPDATA)
MC_DIR = os.path.join(APPDATA, '.minecraft')
TOOL_DIR = os.path.join(LOCAL, 'KariaKurucu')
NO_WINDOW = 0x08000000 if os.name == 'nt' else 0


def resource(name):
    here = globals().get('__file__') or sys.argv[0]
    base = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(here)))
    return os.path.join(base, name)


# ------------------------------------------------------------------ indirme
def fetch_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))


def fetch_text(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read().decode('utf-8').strip()


def download(url, dest, size=0, sha256=None, progress=None):
    """Geçici dosyaya indirir, boyut/SHA256 doğrular, sonra yerine taşır. 3 deneme."""
    tmp = dest + '.part'
    last = None
    for attempt in range(3):
        try:
            h = hashlib.sha256()
            got = 0
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r, open(tmp, 'wb') as f:
                total = int(r.headers.get('Content-Length') or size or 0)
                while True:
                    chunk = r.read(1 << 16)
                    if not chunk:
                        break
                    f.write(chunk)
                    h.update(chunk)
                    got += len(chunk)
                    if progress and total:
                        progress(got, total)
            if size and got != size:
                raise IOError(f'boyut uyuşmuyor ({got} != {size})')
            if sha256 and h.hexdigest().lower() != sha256.lower():
                raise IOError('SHA256 doğrulanamadı')
            os.replace(tmp, dest)
            return
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 + attempt * 2)
    if os.path.exists(tmp):
        os.remove(tmp)
    raise IOError(f'{os.path.basename(dest)} indirilemedi: {last}')


# ------------------------------------------------------------------ sistem
def total_ram_mb():
    if os.name != 'nt':
        return 8192

    class MS(ctypes.Structure):
        _fields_ = [('dwLength', ctypes.c_ulong), ('dwMemoryLoad', ctypes.c_ulong), ('ullTotalPhys', ctypes.c_ulonglong),
                    ('ullAvailPhys', ctypes.c_ulonglong), ('ullTotalPageFile', ctypes.c_ulonglong),
                    ('ullAvailPageFile', ctypes.c_ulonglong), ('ullTotalVirtual', ctypes.c_ulonglong),
                    ('ullAvailVirtual', ctypes.c_ulonglong), ('ullAvailExtendedVirtual', ctypes.c_ulonglong)]
    m = MS()
    m.dwLength = ctypes.sizeof(MS)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
    return int(m.ullTotalPhys / (1024 * 1024))


def launcher_running():
    if os.name != 'nt':
        return False
    try:
        out = subprocess.run(['tasklist', '/FO', 'CSV', '/NH'], capture_output=True, text=True, creationflags=NO_WINDOW).stdout.lower()
    except Exception:  # noqa: BLE001
        return False
    return any(n in out for n in ('"minecraftlauncher.exe"', '"minecraft.exe"'))


# ------------------------------------------------------------------ NBT (servers.dat)
def _nbt_str(s):
    b = s.encode('utf-8')
    return struct.pack('>H', len(b)) + b


def servers_dat(name, address):
    """Tek sunuculu servers.dat: TAG_Compound '' { TAG_List 'servers' [ {name, ip} ] }"""
    entry = b'\x08' + _nbt_str('name') + _nbt_str(name) + b'\x08' + _nbt_str('ip') + _nbt_str(address) + b'\x00'
    return b'\x0a' + _nbt_str('') + b'\x09' + _nbt_str('servers') + b'\x0a' + struct.pack('>i', 1) + entry + b'\x00'


# ------------------------------------------------------------------ kurulum adımları
class Kurulum:
    def __init__(self, log, step):
        self.log, self.step = log, step

    def java(self):
        jdir = os.path.join(TOOL_DIR, 'java21')
        exe = os.path.join(jdir, 'bin', 'java.exe' if os.name == 'nt' else 'java')
        if os.path.exists(exe):
            self.log('Java 21 hazır.')
            return exe
        self.log('Java 21 indiriliyor (Eclipse Temurin)…')
        osname = 'windows' if os.name == 'nt' else 'linux'
        info = fetch_json(f'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jre&os={osname}&vendor=eclipse')
        pkg = info[0]['binary']['package']
        os.makedirs(TOOL_DIR, exist_ok=True)
        arc = os.path.join(TOOL_DIR, pkg['name'])
        download(pkg['link'], arc, pkg['size'], pkg['checksum'], lambda a, b: self.step(a / b))
        tmp = os.path.join(TOOL_DIR, 'java_tmp')
        shutil.rmtree(tmp, ignore_errors=True)
        if arc.endswith('.zip'):
            zipfile.ZipFile(arc).extractall(tmp)
        else:
            import tarfile
            tarfile.open(arc).extractall(tmp)
        inner = os.path.join(tmp, os.listdir(tmp)[0])
        shutil.rmtree(jdir, ignore_errors=True)
        shutil.move(inner, jdir)
        shutil.rmtree(tmp, ignore_errors=True)
        os.remove(arc)
        self.log('Java 21 kuruldu.')
        return exe

    def neoforge(self, java, m):
        vid = f"neoforge-{m['neoforge']}"
        if os.path.exists(os.path.join(MC_DIR, 'versions', vid, vid + '.json')):
            self.log(f'NeoForge {m["neoforge"]} zaten kurulu.')
            return vid
        self.log(f'NeoForge {m["neoforge"]} indiriliyor…')
        inst = os.path.join(TOOL_DIR, f'{vid}-installer.jar')
        sha = fetch_text(m['neoforge_kurucu'] + '.sha256').split()[0]
        download(m['neoforge_kurucu'], inst, 0, sha, lambda a, b: self.step(a / b))
        self.log('NeoForge kuruluyor (Minecraft 1.21.1 dosyaları da iner, birkaç dakika sürebilir)…')
        self.step(None)
        p = subprocess.run([java, '-jar', inst, '--install-client', MC_DIR], capture_output=True, text=True,
                           cwd=TOOL_DIR, creationflags=NO_WINDOW)
        if p.returncode != 0 or not os.path.exists(os.path.join(MC_DIR, 'versions', vid, vid + '.json')):
            tail = (p.stdout + p.stderr).strip().splitlines()[-5:]
            raise RuntimeError('NeoForge kurulamadı:\n' + '\n'.join(tail))
        self.log('NeoForge kuruldu.')
        return vid

    def files(self, items, folder, label, prune):
        os.makedirs(folder, exist_ok=True)
        want = {i['dosya'] for i in items}
        if prune:
            old = [f for f in os.listdir(folder) if f.endswith('.jar') and f not in want]
            if old:
                bak = os.path.join(os.path.dirname(folder), 'mods_eski')
                os.makedirs(bak, exist_ok=True)
                for f in old:
                    shutil.move(os.path.join(folder, f), os.path.join(bak, f))
                self.log(f'{len(old)} eski mod "mods_eski" klasörüne taşındı.')
        todo = [i for i in items if not (os.path.exists(os.path.join(folder, i['dosya']))
                                          and (not i.get('boyut') or os.path.getsize(os.path.join(folder, i['dosya'])) == i['boyut']))]
        if not todo:
            self.log(f'{label}: hepsi güncel ({len(items)}).')
            return
        self.log(f'{label}: {len(todo)} dosya indirilecek…')
        for n, i in enumerate(todo, 1):
            download(i['url'], os.path.join(folder, i['dosya']), i.get('boyut', 0))
            self.step(n / len(todo))
        self.log(f'{label}: {len(items)} dosya hazır.')

    def profile(self, m, vid, game_dir):
        icon = ''
        try:
            icon = 'data:image/png;base64,' + base64.b64encode(open(resource('karia_ikon.png'), 'rb').read()).decode()
        except OSError:
            pass
        ram = min(m['profil'].get('ram_mb', 6144), max(3072, total_ram_mb() - 4096))
        prof = {
            'name': m['profil']['ad'], 'type': 'custom', 'lastVersionId': vid, 'gameDir': game_dir,
            'javaArgs': f'-Xmx{ram}M -Xms{min(ram, 2048)}M -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200',
            'lastUsed': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime()), 'created': '2026-11-13T00:00:00.000Z',
        }
        if icon:
            prof['icon'] = icon
        done = 0
        for fn in ('launcher_profiles.json', 'launcher_profiles_microsoft_store.json'):
            p = os.path.join(MC_DIR, fn)
            if not os.path.exists(p):
                continue
            data = json.load(open(p, encoding='utf-8'))
            data.setdefault('profiles', {})['karia'] = prof
            tmp = p + '.karia-tmp'
            json.dump(data, open(tmp, 'w', encoding='utf-8'), indent=2)
            if not os.path.exists(p + '.karia-yedek'):
                shutil.copy2(p, p + '.karia-yedek')
            os.replace(tmp, p)
            done += 1
        self.log(f'Launcher\'a "{m["profil"]["ad"]}" profili eklendi ({ram // 1024} GB bellek).')
        return done

    def run(self):
        if not os.path.exists(os.path.join(MC_DIR, 'launcher_profiles.json')):
            raise RuntimeError('Minecraft Launcher bulunamadı.\nÖnce resmi Minecraft Launcher\'ı kurup bir kez açıp kapatın, sonra tekrar deneyin.')
        self.log('Mod listesi alınıyor…')
        m = fetch_json(MANIFEST_URL)
        self.log(f'Karia paket sürümü {m["surum"]} · Minecraft {m["minecraft"]} · NeoForge {m["neoforge"]}')
        java = self.java()
        vid = self.neoforge(java, m)
        game_dir = os.path.join(MC_DIR, m['profil']['klasor'])
        self.files(m['modlar'], os.path.join(game_dir, 'mods'), 'Modlar', prune=True)
        self.files(m.get('golgelendiriciler', []), os.path.join(game_dir, 'shaderpacks'), 'Gölgelendiriciler', prune=False)
        sd = os.path.join(game_dir, 'servers.dat')
        if not os.path.exists(sd):
            open(sd, 'wb').write(servers_dat(m['sunucu']['ad'], m['sunucu']['adres']))
            self.log(f'Sunucu listesine {m["sunucu"]["adres"]} eklendi.')
        opt = os.path.join(game_dir, 'options.txt')
        if not os.path.exists(opt):
            open(opt, 'w', encoding='utf-8').write('lang:tr_tr\n')
        self.profile(m, vid, game_dir)
        return m


# ------------------------------------------------------------------ arayüz
class App:
    def __init__(self, root):
        self.root = root
        self.q = queue.Queue()
        root.title('Karia Kurucu')
        root.geometry('560x420')
        root.resizable(False, False)
        root.configure(bg='#0d1b1e')
        try:
            root.iconphoto(True, tk.PhotoImage(file=resource('karia_ikon.png')))
        except tk.TclError:
            pass
        style = ttk.Style()
        style.theme_use('clam')
        style.configure('K.Horizontal.TProgressbar', troughcolor='#13282c', background='#3fe0c5', bordercolor='#13282c')
        tk.Label(root, text='KARIA', fg='#3fe0c5', bg='#0d1b1e', font=('Segoe UI', 26, 'bold')).pack(pady=(18, 0))
        tk.Label(root, text='Ejderhalar ve Gemiler · Modlu sunucu kurulumu', fg='#9fb8b4', bg='#0d1b1e',
                 font=('Segoe UI', 10)).pack()
        self.bar = ttk.Progressbar(root, style='K.Horizontal.TProgressbar', length=500, mode='determinate', maximum=1.0)
        self.bar.pack(pady=(18, 8))
        self.text = tk.Text(root, height=11, width=66, bg='#13282c', fg='#d8ece8', relief='flat', font=('Consolas', 9),
                            state='disabled', wrap='word')
        self.text.pack(padx=20)
        bf = tk.Frame(root, bg='#0d1b1e')
        bf.pack(pady=12)
        self.btn = tk.Button(bf, text='Kur / Güncelle', command=self.start, bg='#3fe0c5', fg='#0d1b1e', relief='flat',
                             font=('Segoe UI', 11, 'bold'), padx=18, pady=4, activebackground='#2fbfa6')
        self.btn.pack(side='left', padx=6)
        tk.Button(bf, text='Kapat', command=root.destroy, bg='#24403f', fg='#d8ece8', relief='flat',
                  font=('Segoe UI', 11), padx=18, pady=4).pack(side='left', padx=6)
        self.log('Hazır. "Kur / Güncelle"ye basın. Minecraft Launcher kapalı olmalı.')
        root.after(100, self.poll)

    def log(self, s):
        self.q.put(('log', s))

    def step(self, v):
        self.q.put(('step', v))

    def poll(self):
        try:
            while True:
                kind, v = self.q.get_nowait()
                if kind == 'log':
                    self.text.configure(state='normal')
                    self.text.insert('end', '• ' + v + '\n')
                    self.text.see('end')
                    self.text.configure(state='disabled')
                elif kind == 'step':
                    if v is None:
                        self.bar.configure(mode='indeterminate')
                        self.bar.start(12)
                    else:
                        self.bar.stop()
                        self.bar.configure(mode='determinate', value=v)
                elif kind == 'done':
                    self.bar.stop()
                    self.bar.configure(mode='determinate', value=1.0)
                    self.btn.configure(state='normal')
                    messagebox.showinfo('Karia', 'Kurulum tamam!\n\nMinecraft Launcher\'ı açın, sol alttan "Karia" profilini seçin '
                                                 've Oyna\'ya basın. Sunucu listesinde Karia hazır.')
                elif kind == 'error':
                    self.bar.stop()
                    self.btn.configure(state='normal')
                    messagebox.showerror('Karia Kurucu', v)
        except queue.Empty:
            pass
        self.root.after(100, self.poll)

    def start(self):
        if launcher_running():
            messagebox.showwarning('Karia Kurucu', 'Minecraft Launcher açık görünüyor.\nLütfen kapatıp tekrar deneyin '
                                                   '(launcher açıkken profil değişikliğini geri alır).')
            return
        self.btn.configure(state='disabled')

        def work():
            try:
                Kurulum(self.log, self.step).run()
                self.log('Bitti.')
                self.q.put(('done', None))
            except Exception as e:  # noqa: BLE001
                self.log('HATA: ' + str(e).splitlines()[0])
                self.q.put(('error', str(e)))
        threading.Thread(target=work, daemon=True).start()


def main():
    if '--sessiz' in sys.argv:          # test için arayüzsüz çalıştırma
        Kurulum(lambda s: print('•', s, flush=True), lambda v: None).run()
        return
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == '__main__':
    main()
