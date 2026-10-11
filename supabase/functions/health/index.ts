// Liveness check for the uptime monitor and the canary. No auth, no data.
Deno.serve(() => Response.json({ ok: true, service: "flow-engine" }));
