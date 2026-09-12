"use strict";
// Read-only probe: invoke the With desktop daemon's user-setting RPC to obtain the
// authoritative user_setting structure (field names, defaults, permission_mode values).
const { DesktopTransport, discoverEndpoint } = require("../with-desktop-acp/transport.cjs");

(async () => {
  const endpoint = await discoverEndpoint();
  console.log("endpoint:", endpoint);
  const t = new DesktopTransport({ requestTimeout: 15000 }.constructor === Object ? await discoverEndpoint() && endpoint || endpoint : endpoint, { requestTimeout: 15000 });
  const attempts = [
    ["my_task_user_setting_get", {}],
    ["my_task_user_setting_get", { scene: "with-app" }],
    ["my_task_user_setting_get", { origin: "with-app" }],
    ["my_task_user_setting_get", { key: "" }],
  ];
  for (const [cmd, args] of attempts) {
    try {
      const r = await t.invoke(cmd, args);
      console.log(`\n== ${cmd} ${JSON.stringify(args)} ==`);
      console.log(JSON.stringify(r, null, 2).slice(0, 3000));
    } catch (e) {
      console.log(`\n== ${cmd} ${JSON.stringify(args)} == ERROR: ${e.message}`);
    }
  }
  t.close();
})().catch((e) => { console.error("fatal:", e.message); process.exit(1); });
