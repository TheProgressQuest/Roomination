// Phone testing: serves the built prototype (dist/) to devices on the same Wi-Fi over HTTPS
// (IPv4 and IPv6: a Mac's .local name often resolves to IPv6 first),
// which browsers require for storing photos and 3D models (a plain http:// address on the
// network isn't a "secure context").
//
//   npm run phone-test
//
// A small certificate authority is created once in ~/.roomination-phone-test (never in the
// repository). It may only vouch for local addresses (.local names, localhost and private
// IP ranges), so it can't be used to impersonate any real website. The iPhone trusts it once:
// open the printed http:// address and follow the steps there. Remove the profile from the
// iPhone after testing (Settings → General → VPN & Device Management).
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { homedir, networkInterfaces } from 'node:os';
import { extname, join, normalize } from 'node:path';

const HTTPS_PORT = 4443;
const HELP_PORT = 4080;
const dir = join(homedir(), '.roomination-phone-test');
const root = join(process.cwd(), 'dist');
const prefix = '/Roomination/';

if (!existsSync(join(root, 'index.html'))) {
  console.error('No build found. Run "npm run phone-test" (it builds first).');
  process.exit(1);
}

let host = 'localhost';
try {
  host = execFileSync('scutil', ['--get', 'LocalHostName']).toString().trim();
} catch {
  /* not a Mac: localhost and IP addresses still work */
}
const local = host === 'localhost' ? 'localhost' : `${host}.local`;
const ips = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i.address);

const openssl = (...args) => execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
mkdirSync(dir, { recursive: true, mode: 0o700 });

// The certificate authority (once). Name constraints keep it to local addresses.
if (!existsSync(join(dir, 'ca.crt'))) {
  writeFileSync(
    join(dir, 'ca.cnf'),
    [
      '[req]',
      'distinguished_name = dn',
      'prompt = no',
      'x509_extensions = ca',
      '[dn]',
      'CN = Roomination phone test (this Mac only)',
      '[ca]',
      'basicConstraints = critical, CA:TRUE, pathlen:0',
      'keyUsage = critical, keyCertSign, cRLSign',
      'subjectKeyIdentifier = hash',
      'nameConstraints = critical, permitted;DNS:local, permitted;DNS:localhost, permitted;IP:10.0.0.0/255.0.0.0, permitted;IP:172.16.0.0/255.240.0.0, permitted;IP:192.168.0.0/255.255.0.0, permitted;IP:127.0.0.0/255.0.0.0',
    ].join('\n'),
  );
  openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '825', '-config', 'ca.cnf');
  openssl('x509', '-in', 'ca.crt', '-outform', 'der', '-out', 'ca.cer');
}

// The server's certificate, renewed whenever this Mac's name or addresses change.
const names = [local, 'localhost', ...ips, '127.0.0.1'].join(',');
if (!existsSync(join(dir, 'server.crt')) || readFileSync(join(dir, 'names.txt'), 'utf8').trim() !== names) {
  writeFileSync(
    join(dir, 'server.cnf'),
    [
      'basicConstraints = critical, CA:FALSE',
      'keyUsage = critical, digitalSignature, keyEncipherment',
      'extendedKeyUsage = serverAuth',
      `subjectAltName = ${[`DNS:${local}`, 'DNS:localhost', ...ips.map((ip) => `IP:${ip}`), 'IP:127.0.0.1'].join(', ')}`,
    ].join('\n'),
  );
  openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', `/CN=${local}`);
  // Apple accepts server certificates valid for at most 825 days.
  openssl('x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.crt', '-days', '397', '-extfile', 'server.cnf');
  writeFileSync(join(dir, 'names.txt'), names);
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.webp': 'image/webp', '.md': 'text/markdown', '.webmanifest': 'application/manifest+json' };

function serveDist(req, res) {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (url === '/' || url === '') {
    res.writeHead(302, { Location: prefix }).end();
    return;
  }
  if (!url.startsWith(prefix)) return void res.writeHead(404).end('Not found');
  let file = normalize(join(root, url.slice(prefix.length)));
  if (!file.startsWith(root)) return void res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) return void res.writeHead(404).end('Not found');
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
}

createHttpsServer({ key: readFileSync(join(dir, 'server.key')), cert: readFileSync(join(dir, 'server.crt')) }, serveDist).listen(HTTPS_PORT, '::');
// On the Mac itself, localhost needs no certificate (browsers treat it as secure). Mac only.
const MAC_PORT = 4174;
createHttpServer(serveDist).listen(MAC_PORT, '127.0.0.1');

// Plain http, for one thing only: the certificate and how to trust it on an iPhone.
const helpPage = `<!doctype html><meta name="viewport" content="width=device-width"><title>Roomination phone test</title>
<body style="font:17px/1.5 -apple-system,system-ui;margin:24px;max-width:560px">
<h1 style="font-size:22px">Roomination phone test</h1>
<p><b>Once per iPhone</b>, so it trusts this Mac's test address:</p>
<ol>
<li><a href="/ca.cer">Tap here to download the test certificate</a>, then tap <b>Allow</b> and <b>Close</b>.</li>
<li>Open <b>Settings</b> → <b>Profile Downloaded</b> (near the top) → <b>Install</b> (twice).</li>
<li>Open <b>Settings → General → About → Certificate Trust Settings</b> and switch on <b>Roomination phone test</b>.</li>
</ol>
<p>Then open <a href="https://${local}:${HTTPS_PORT}${prefix}">https://${local}:${HTTPS_PORT}${prefix}</a></p>
<p style="color:#555;font-size:14px">The certificate only works for addresses on your own network. Remove it after testing: Settings → General → VPN &amp; Device Management.</p>`;
createHttpServer((req, res) => {
  if (req.url === '/ca.cer') {
    res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="roomination-phone-test.cer"' });
    createReadStream(join(dir, 'ca.cer')).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(helpPage);
}).listen(HELP_PORT, '::');

console.log(`
Roomination phone test is running (Ctrl+C to stop).

  On the iPhone, first time only:  http://${local}:${HELP_PORT}
  Then, on the iPhone:             https://${local}:${HTTPS_PORT}${prefix}
  On this Mac:                     http://localhost:${MAC_PORT}${prefix}
${ips.map((ip) => `  (or by address:                   https://${ip}:${HTTPS_PORT}${prefix})`).join('\n')}

Only the app's own files are served. Your projects, photos and models stay in each browser.
`);
