import { appendFileSync, readFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { TLSSocket } from 'node:tls';

/**
 * A minimal SMTP server for the alert tests (F9, T041): it speaks first, offers STARTTLS, then
 * AUTH PLAIN, and appends every mail it receives to a file as one JSON line. It runs as its own
 * process because the test calls the script with `spawnSync`, which blocks the event loop of the
 * test process: a server in that process could never answer.
 *
 *   node smtp-server.ts <key.pem> <cert.pem> <out.jsonl>     prints `listening <port>` when ready
 */
const [keyFile = '', certFile = '', outFile = ''] = process.argv.slice(2);
const key = readFileSync(keyFile, 'utf8');
const cert = readFileSync(certFile, 'utf8');

interface Mail {
  from: string;
  to: string[];
  data: string;
  user: string;
  password: string;
}

const server = createServer((raw: Socket) => {
  let socket: Socket = raw;
  let buffer = '';
  let inData = false;
  let authPending = false;
  let mail: Mail = { from: '', to: [], data: '', user: '', password: '' };
  const send = (line: string): void => void socket.write(`${line}\r\n`);
  const credentials = (encoded: string): void => {
    const [user = '', password = ''] = Buffer.from(encoded, 'base64')
      .toString('utf8')
      .split('\0')
      .slice(1);
    mail.user = user;
    mail.password = password;
    send('235 ok');
  };
  const onData = (chunk: Buffer): void => {
    buffer += chunk.toString('utf8');
    for (;;) {
      if (inData) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end === -1) return;
        mail.data = buffer.slice(0, end);
        buffer = buffer.slice(end + 5);
        inData = false;
        appendFileSync(outFile, `${JSON.stringify(mail)}\n`);
        mail = { from: '', to: [], data: '', user: mail.user, password: mail.password };
        send('250 queued');
        continue;
      }
      const eol = buffer.indexOf('\r\n');
      if (eol === -1) return;
      const line = buffer.slice(0, eol);
      buffer = buffer.slice(eol + 2);
      if (authPending) {
        authPending = false;
        credentials(line);
        continue;
      }
      const [verb = '', ...rest] = line.split(' ');
      switch (verb.toUpperCase()) {
        case 'EHLO':
          socket.write(
            socket instanceof TLSSocket
              ? '250-test\r\n250 AUTH PLAIN\r\n'
              : '250-test\r\n250 STARTTLS\r\n',
          );
          break;
        case 'STARTTLS': {
          send('220 ready');
          socket.removeListener('data', onData);
          // TLS 1.2 only: no post-handshake tickets, which some clients mistake for renegotiation.
          const secure = new TLSSocket(socket, {
            isServer: true,
            key,
            cert,
            maxVersion: 'TLSv1.2',
          });
          secure.on('data', onData);
          secure.on('error', () => undefined);
          socket = secure;
          break;
        }
        case 'AUTH':
          if (rest[1]) {
            credentials(rest[1]);
          } else {
            // No initial response: ask for it; the next line is the credentials.
            authPending = true;
            send('334 ');
          }
          break;
        case 'MAIL':
          mail.from = /<([^>]*)>/.exec(line)?.[1] ?? '';
          send('250 ok');
          break;
        case 'RCPT':
          mail.to.push(/<([^>]*)>/.exec(line)?.[1] ?? '');
          send('250 ok');
          break;
        case 'DATA':
          inData = true;
          send('354 go');
          break;
        case 'QUIT':
          send('221 bye');
          socket.end();
          return;
        default:
          send('250 ok');
      }
    }
  };
  raw.on('data', onData);
  raw.on('error', () => undefined);
  // An SMTP server speaks first.
  send('220 test ESMTP');
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  process.stdout.write(`listening ${typeof address === 'object' && address ? address.port : 0}\n`);
});
