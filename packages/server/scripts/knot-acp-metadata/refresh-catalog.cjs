"use strict";
const { loadCatalog } = require("./catalog-cache.cjs");
async function main(argv) {
  if (argv.length !== 2 || argv[0] !== "--config")
    throw new Error(
      "Usage: node refresh-catalog.cjs --config SOURCE_YAML_PATH",
    );
  const result = await loadCatalog({
    source: argv[1],
    refresh: true,
    log: (message) => process.stderr.write(`[knot-metadata] ${message}\n`),
  });
  console.log(
    JSON.stringify({
      source: result.source,
      updatedAt: result.updatedAt,
      models: result.models.length,
      cachePath: result.cachePath,
      persisted: result.persisted === true,
    }),
  );
  return result.persisted === true ? 0 : 1;
}
if (require.main === module)
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
module.exports = { main };
