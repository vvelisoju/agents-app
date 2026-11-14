// TOOL-28 — importing this self-registers every first-party tool (mirrors channel-adapter
// registration). Registration only populates a Map; the reply path never reads the registry
// unless an agent is explicitly executionMode='agentic' with tools enabled, so boot stays
// byte-for-byte today's.
import './knowledge';
import './crm';
import './web';
