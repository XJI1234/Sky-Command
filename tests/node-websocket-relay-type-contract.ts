import { NodeWebSocketRelayTransport, type WebSocketServerFactory } from "../src/adapters/node-websocket-relay/index.js";
import type { RelayTransport } from "../src/modules/relay-link/relay-server/index.js";

declare const factory: WebSocketServerFactory;
const transport: RelayTransport = NodeWebSocketRelayTransport.create({ factory });
void transport.listen({ host: "127.0.0.1", port: 9000 }, () => undefined);
// @ts-expect-error A WebSocket server factory must expose an open state.
NodeWebSocketRelayTransport.create({ factory: { create: factory.create } });
