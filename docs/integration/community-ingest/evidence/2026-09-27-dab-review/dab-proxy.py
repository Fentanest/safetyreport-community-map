"""Local forward proxy for DAB review: maps safemap.worklazy.net(:80) -> 127.0.0.1:4176,
passes everything else through. Lets Chrome request http://safemap.worklazy.net/
(port 80, no host-file change) so Kakao's domain check passes."""
import socket, threading, sys

LISTEN = ('127.0.0.1', 18888)
TARGET_HOST = 'safemap.worklazy.net'
TARGET_UPSTREAM = ('127.0.0.1', 4176)
BUF = 65536

def pipe(a, b):
    try:
        while True:
            d = a.recv(BUF)
            if not d:
                break
            b.sendall(d)
    except OSError:
        pass
    finally:
        for s in (a, b):
            try: s.shutdown(socket.SHUT_RDWR)
            except OSError: pass
            s.close()

def handle(client):
    try:
        head = b''
        client.settimeout(10)
        while b'\r\n\r\n' not in head:
            chunk = client.recv(BUF)
            if not chunk:
                client.close(); return
            head += chunk
        header, _, rest = head.partition(b'\r\n\r\n')
        lines = header.decode('latin1').split('\r\n')
        method, target, _ = lines[0].split(' ', 2)
        host_hdr = ''
        for ln in lines[1:]:
            if ln.lower().startswith('host:'):
                host_hdr = ln[5:].strip()
                break
        if method.upper() == 'CONNECT':
            # target = host:port
            h, _, p = target.partition(':')
            if h.lower() == TARGET_HOST:
                upstream = socket.create_connection(TARGET_UPSTREAM, timeout=10)
                # strip :4176? CONNECT target port must match; tell client ok and relay raw
                client.sendall(b'HTTP/1.1 200 Connection Established\r\n\r\n')
            else:
                upstream = socket.create_connection((h, int(p or 443)), timeout=10)
                client.sendall(b'HTTP/1.1 200 Connection Established\r\n\r\n')
            if rest:
                upstream.sendall(rest)
            t1 = threading.Thread(target=pipe, args=(client, upstream), daemon=True)
            t2 = threading.Thread(target=pipe, args=(upstream, client), daemon=True)
            t1.start(); t2.start(); t1.join(); t2.join()
            return
        # plain HTTP: absolute URI or origin-form
        if target.startswith('http://') or target.startswith('https://'):
            from urllib.parse import urlsplit
            parts = urlsplit(target)
            h = parts.hostname or ''
            port = parts.port or (443 if parts.scheme == 'https' else 80)
            path = parts.path or '/'
            if parts.query: path += '?' + parts.query
        else:
            h, _, p = host_hdr.partition(':')
            port = int(p) if p.isdigit() else 80
            path = target
        if h.lower() == TARGET_HOST:
            upstream = socket.create_connection(TARGET_UPSTREAM, timeout=10)
            # rewrite request line to origin-form, fix Host
            new_lines = [f'{method} {path} HTTP/1.1']
            for ln in lines[1:]:
                if ln.lower().startswith('host:'):
                    new_lines.append('Host: safemap.worklazy.net')
                elif ln.lower().startswith('proxy-'):
                    continue
                else:
                    new_lines.append(ln)
            upstream.sendall(('\r\n'.join(new_lines) + '\r\n\r\n').encode('latin1') + rest)
        else:
            upstream = socket.create_connection((h, port), timeout=10)
            new_lines = [f'{method} {path} HTTP/1.1']
            for ln in lines[1:]:
                if ln.lower().startswith('proxy-'):
                    continue
                new_lines.append(ln)
            upstream.sendall(('\r\n'.join(new_lines) + '\r\n\r\n').encode('latin1') + rest)
        t1 = threading.Thread(target=pipe, args=(client, upstream), daemon=True)
        t2 = threading.Thread(target=pipe, args=(upstream, client), daemon=True)
        t1.start(); t2.start(); t1.join(); t2.join()
    except Exception as e:
        try: client.close()
        except OSError: pass

srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(LISTEN); srv.listen(100)
print('proxy on', LISTEN, flush=True)
while True:
    c, _ = srv.accept()
    threading.Thread(target=handle, args=(c,), daemon=True).start()
