#!/usr/bin/env python3
"""Basit RCON istemcisi (yalnızca 127.0.0.1). Kullanım: python rcon.py <server.properties> "komut" ["komut" ...]"""
import socket
import struct
import sys

sys.stdout.reconfigure(encoding='utf-8')


def props(path):
    out = {}
    for line in open(path, encoding='utf-8'):
        if '=' in line and not line.startswith('#'):
            k, v = line.rstrip('\n').split('=', 1)
            out[k.strip()] = v.strip()
    return out


def packet(rid, typ, body):
    b = body.encode('utf-8')
    return struct.pack('<iii', len(b) + 10, rid, typ) + b + b'\x00\x00'


def recv(s):
    n = struct.unpack('<i', s.recv(4))[0]
    data = b''
    while len(data) < n:
        data += s.recv(n - len(data))
    return struct.unpack('<ii', data[:8]), data[8:-2].decode('utf-8', 'replace')


def main():
    p = props(sys.argv[1])
    s = socket.create_connection(('127.0.0.1', int(p['rcon.port'])), timeout=30)
    s.sendall(packet(1, 3, p['rcon.password']))
    (rid, _), _ = recv(s)
    if rid == -1:
        sys.exit('RCON parolası reddedildi')
    for i, cmd in enumerate(sys.argv[2:], start=2):
        s.sendall(packet(i, 2, cmd))
        _, body = recv(s)
        print(f'> {cmd}\n{body}')
    s.close()


if __name__ == '__main__':
    main()
