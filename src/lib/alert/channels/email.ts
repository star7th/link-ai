export interface EmailConfig {
  smtp: string;
  port: number;
  user: string;
  password: string;
  from: string;
  useTls?: boolean;
  recipients?: string[];
}

export async function sendEmail(config: EmailConfig, to: string[], subject: string, body: string): Promise<{ success: boolean; error?: string }> {
  console.log(`[Email Channel] Sending to: ${to.join(', ')}, Subject: ${subject}`);
  console.log(`[Email Channel] SMTP: ${config.smtp}:${config.port}, From: ${config.from}`);

  try {
    const { createConnection } = await import('net');

    return new Promise((resolve) => {
      const socket = createConnection({ host: config.smtp, port: config.port });
      socket.setTimeout(15000);
      socket.setEncoding('utf-8');

      let buffer = '';
      let authenticated = false;
      let mailSent = false;

      const write = (data: string) => socket.write(data + '\r\n');

      socket.on('data', (data: string) => {
        buffer += data;
        if (!buffer.includes('\r\n')) return;

        const lines = buffer.split('\r\n').filter(Boolean);
        buffer = '';

        for (const line of lines) {
          if (line.startsWith('220') && !authenticated) {
            write('EHLO link-ai');
          } else if (line.startsWith('250') && !authenticated) {
            write('AUTH LOGIN');
          } else if (line.startsWith('334') && !authenticated) {
            const payload = line.includes('VXNlcm5hbWU6')
              ? Buffer.from(config.user).toString('base64')
              : Buffer.from(config.password).toString('base64');
            write(payload);
          } else if (line.startsWith('235') && !authenticated) {
            authenticated = true;
            write(`MAIL FROM:<${config.from}>`);
          } else if (line.startsWith('250') && authenticated && !mailSent) {
            if (!line.includes('OK')) {
              write(`RCPT TO:<${to[0]}>`);
            } else {
              write('DATA');
            }
          } else if (line.startsWith('250') && authenticated) {
            write('DATA');
          } else if (line.startsWith('354')) {
            const encodedSubject = Buffer.from(subject).toString('base64');
            const emailContent = [
              `From: ${config.from}`,
              `To: ${to.join(', ')}`,
              `Subject: =?UTF-8?B?${encodedSubject}?=`,
              'Content-Type: text/plain; charset=UTF-8',
              '',
              body,
              '.',
            ].join('\r\n');
            write(emailContent);
            mailSent = true;
          } else if (line.startsWith('250') && mailSent) {
            write('QUIT');
            socket.end();
            resolve({ success: true });
            return;
          } else if (line.startsWith('5')) {
            socket.end();
            resolve({ success: false, error: `SMTP error: ${line}` });
            return;
          }
        }
      });

      socket.on('error', (err: Error) => {
        resolve({ success: false, error: err.message });
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve({ success: false, error: 'Connection timeout' });
      });
    });
  } catch (error: any) {
    console.error('Failed to send email:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}
