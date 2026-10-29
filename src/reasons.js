// The fixed failure-reason vocabulary (architecture §6.3, AC-A8). The monitor
// generates every reason itself; nothing from a response is ever stored.

export const REASON = Object.freeze({
  timeout: 'timeout',
  dns: 'DNS failure',
  tls: 'TLS error',
  connection: 'connection error',
  blockedAddress: 'blocked address',
  blockedRedirect: 'blocked redirect',
  tooManyRedirects: 'too many redirects',
});

const FIXED = new Set(Object.values(REASON));

export const httpReason = (status) => `HTTP ${status}`;

export function isKnownReason(r) {
  return typeof r === 'string' && (FIXED.has(r) || /^HTTP [1-5]\d\d$/.test(r));
}

/** Owner-facing reason text for issues (design §10.1). */
export function ownerReasonText(reason, timeoutSeconds) {
  switch (reason) {
    case REASON.timeout: return `No answer within ${timeoutSeconds} seconds (timeout)`;
    case REASON.dns: return 'The domain name could not be found (DNS error)';
    case REASON.tls: return 'The secure connection failed (TLS/certificate error)';
    case REASON.connection: return 'The connection was refused or dropped';
    case REASON.tooManyRedirects: return 'More than 5 redirects';
    case REASON.blockedRedirect: return 'A redirect pointed to a private or blocked address, so the monitor did not follow it';
    case REASON.blockedAddress: return 'The address points to a private or blocked network address, so the monitor did not check it';
    default: {
      const m = /^HTTP (\d{3})$/.exec(String(reason));
      return m ? `The site answered with HTTP ${m[1]}` : 'Something went wrong when checking';
    }
  }
}
