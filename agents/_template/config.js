// =============================================================
// agents/_template/config.js
// Copy this whole "_template" folder to make a new agent.
// Put all your editable settings here.
// =============================================================

module.exports = {
  model: 'claude-opus-5-5', // or 'claude-haiku-5-5' for cheaper/faster

  // The persona / rules for this agent. Describe who it is and how to behave.
  systemPrompt: `You are a helpful assistant. Answer clearly and briefly.`,
};
