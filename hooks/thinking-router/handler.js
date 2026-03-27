const { handleHookEvent } = require('../../scripts/thinking-router.js');

async function handler(event) {
  try {
    return await handleHookEvent(event, { dryRun: false });
  } catch (error) {
    console.error('[thinking-router] hook error:', error?.stack || String(error));
    return;
  }
}

module.exports = handler;
module.exports.default = handler;
