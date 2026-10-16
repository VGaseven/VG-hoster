// fetch() for AI-supplied URLs: public http(s) only, so an AI can't reach the server's own network
// (localhost, cloud metadata, private ranges). Every redirect hop is checked too.
import dns from "node:dns/promises";
import net from "node:net";

const blocked = new net.BlockList();
for (const [ip, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4]]) blocked.addSubnet(ip, bits, "ipv4");
for (const [ip, bits] of [["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]])
  blocked.addSubnet(ip, bits, "ipv6");

export const isPrivateIp = (ip) => blocked.check(ip, net.isIPv4(ip) ? "ipv4" : "ipv6");

export async function assertPublicUrl(raw) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`Blocked: only http and https URLs are allowed`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true, verbatim: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error(`Blocked: ${url.hostname} is a private or internal address`);
  return url;
}

const MAX_BYTES = 2_000_000;

// Returns { status, text }. Reads at most MAX_BYTES of the body.
export async function safeFetchText(raw, { headers = {}, timeoutMs = 20000, maxRedirects = 5 } = {}) {
  let url = raw;
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(url);
    const r = await fetch(url, { headers, redirect: "manual", signal });
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) { await r.body?.cancel(); url = new URL(loc, url).toString(); continue; }
    const chunks = [];
    let size = 0;
    for await (const c of r.body ?? []) {
      chunks.push(c); size += c.length;
      if (size >= MAX_BYTES) break;
    }
    return { status: r.status, text: Buffer.concat(chunks).toString("utf8") };
  }
  throw new Error(`Too many redirects (more than ${maxRedirects})`);
}
