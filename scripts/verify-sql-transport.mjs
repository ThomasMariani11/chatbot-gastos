// Manual: requires --run-live. Never sends passwords, tokens or data queries.
import net from "node:net";
import tls from "node:tls";
import { readFile, writeFile } from "node:fs/promises";

if (!process.argv.includes("--run-live")) {
  throw new Error(
    "Use --run-live to probe the linked Supabase project explicitly",
  );
}
if (!process.env.INF05_CA_FILE) {
  throw new Error("INF05_CA_FILE must point to the official Supabase root CA");
}
const ref = (await readFile("supabase/.temp/project-ref", "utf8")).trim();
if (!/^[a-z0-9]{20}$/.test(ref)) {
  throw new Error("Unexpected project reference");
}
const pooler = new URL(
  (await readFile("supabase/.temp/pooler-url", "utf8")).trim(),
);
if (!pooler.hostname.endsWith(".pooler.supabase.com")) {
  throw new Error("Unexpected pooler host");
}
const ca = await readFile(process.env.INF05_CA_FILE, "utf8");
const endpoints = [{
  route: "pooler_session",
  host: pooler.hostname,
  port: 5432,
  user: `postgres.${ref}`,
}, {
  route: "pooler_transaction",
  host: pooler.hostname,
  port: 6543,
  user: `postgres.${ref}`,
}, {
  route: "direct",
  host: `db.${ref}.supabase.co`,
  port: 5432,
  user: "postgres",
}];

function probe(endpoint, encrypted) {
  return new Promise((resolve) => {
    let socket, done = false, protocol = null, authorized = false;
    const deadline = setTimeout(() => finish({ outcome: "timeout" }), 10000);
    const finish = (data) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      socket?.destroy();
      resolve({
        route: endpoint.route,
        encrypted,
        ...(protocol ? { protocol, authorized } : {}),
        ...data,
      });
    };
    const readStartup = () => {
      const params = Buffer.from(
        `user\0${endpoint.user}\0database\0postgres\0application_name\0pesito_inf05_transport_probe\0\0`,
      );
      const packet = Buffer.alloc(params.length + 8);
      packet.writeInt32BE(packet.length);
      packet.writeInt32BE(196608, 4);
      params.copy(packet, 8);
      let input = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        input = Buffer.concat([input, chunk]);
        if (input.length < 5) return;
        const length = input.readInt32BE(1);
        if (length < 4 || length > 65536) {
          return finish({ outcome: "invalid_protocol_response" });
        }
        if (input.length < length + 1) return;
        if (input[0] === 82) {
          return finish({
            outcome: encrypted
              ? "authentication_requested_with_verified_tls"
              : "authentication_requested_without_tls",
          });
        }
        if (input[0] === 69) {
          const reason = input.subarray(5, length + 1).toString();
          const outcome = /ssl|tls/i.test(reason) &&
              /required|must|enforc|no encryption/i.test(reason)
            ? "plaintext_rejected_tls_required"
            : /EADDRNOTALLOWED|network restriction|not in.*allow|allowlist|pg_hba/i
                .test(reason)
            ? "connection_rejected_network"
            : "connection_rejected_other_reason";
          return finish({ outcome }); // Never log server messages: they can contain client IPs.
        }
        finish({ outcome: "unexpected_protocol_response" });
      });
      socket.write(packet);
    };
    socket = net.connect({ host: endpoint.host, port: endpoint.port });
    socket.once(
      "error",
      (error) =>
        finish({
          outcome: "unavailable",
          code: error.code ?? "CONNECTION_ERROR",
        }),
    );
    socket.once("close", () => finish({ outcome: "connection_closed" }));
    socket.once("connect", () => {
      if (!encrypted) return readStartup();
      const ssl = Buffer.alloc(8);
      ssl.writeInt32BE(8);
      ssl.writeInt32BE(80877103, 4);
      socket.write(ssl);
      socket.once("data", (chunk) => {
        if (chunk.toString() !== "S") {
          return finish({ outcome: "ssl_not_available" });
        }
        socket = tls.connect({
          socket,
          servername: endpoint.host,
          ca,
          rejectUnauthorized: true,
          minVersion: "TLSv1.2",
        });
        socket.once(
          "error",
          (error) =>
            finish({
              outcome: "tls_verification_failed",
              code: error.code ?? "TLS_ERROR",
            }),
        );
        socket.once("secureConnect", () => {
          protocol = socket.getProtocol();
          authorized = socket.authorized;
          readStartup();
        });
      });
    });
  });
}

const results = [];
for (const endpoint of endpoints) {
  for (const encrypted of [false, true]) {
    results.push(await probe(endpoint, encrypted));
  }
}
const evidence = { credentials_sent: false, data_queries_sent: false, results };
if (process.env.INF05_OUTPUT_FILE) {
  await writeFile(
    process.env.INF05_OUTPUT_FILE,
    JSON.stringify(evidence, null, 2) + "\n",
  );
}
console.log(JSON.stringify(evidence));
// Inconclusive routes remain visible in the JSON; success is never inferred from a timeout.

const poolerChecks = results.filter((result) => result.route !== "direct");
process.exitCode = poolerChecks.every((result) =>
    result.outcome ===
      (result.encrypted
        ? "authentication_requested_with_verified_tls"
        : "plaintext_rejected_tls_required")
  )
  ? 0
  : 2;
