// Self-registering workflow handlers. Importing this module registers every built-in handler
// on the registry (mirrors how channel adapters self-register). Boot imports it once; tests
// that exercise a handler import it directly.
import './scheduledMonitor';
import './outboundDrip';
