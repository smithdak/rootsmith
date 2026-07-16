import { connect } from "node:tls";

/**
 * Live TLS certificate expiry — the M2 cert audit reads the cert actually
 * being served, not CT logs (crt.sh shows issuance history, not what's on
 * the wire today). rejectUnauthorized: false on purpose: an already-expired
 * cert must be observable, not a connection error.
 */
export function certExpiry(
  host: string,
  timeoutMs = 6000
): Promise<{ ok: true; validTo: string; daysLeft: number } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    const sock = connect({ host, port: 443, servername: host, rejectUnauthorized: false }, () => {
      const cert = sock.getPeerCertificate();
      sock.destroy();
      if (!cert?.valid_to) return resolve({ ok: false, reason: "no certificate presented" });
      const validTo = new Date(cert.valid_to);
      resolve({
        ok: true,
        validTo: validTo.toISOString().slice(0, 10),
        daysLeft: Math.floor((validTo.getTime() - Date.now()) / 86_400_000),
      });
    });
    sock.setTimeout(timeoutMs, () => { sock.destroy(); resolve({ ok: false, reason: "TLS timeout" }); });
    sock.on("error", (e) => resolve({ ok: false, reason: e.message }));
  });
}
