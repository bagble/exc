import { SSEConnection } from "$lib/client/workers/sse_connection";

const connections = new Map<MessagePort, SSEConnection>();
let globalSSEConnection: SSEConnection | null = null;

(self as any).onconnect = function(e: MessageEvent) {
    const port = e.ports[0];

    port.onmessage = function(event) {
        const data = event.data;

        if (data.type === 'connect') {
            if (!globalSSEConnection) {
                const events = ['order'];

                globalSSEConnection = new SSEConnection({
                    url: '/api/sse/notify',
                    events: events,
                    maxReconnectAttempts: 10
                });

                globalSSEConnection['onMessage'] = (data: any) => {
                    connections.forEach((_, port) => {
                        port.postMessage(data);
                    });
                };

                globalSSEConnection.connect();
            }

            connections.set(port, globalSSEConnection);
            port.postMessage({ type: 'connectionState', state: 'connecting' });
        }

        if (data.type === 'disconnect') {
            connections.delete(port);

            if (connections.size === 0 && globalSSEConnection) {
                globalSSEConnection.disconnect();
                globalSSEConnection = null;
            }
        }
    };

    port.start();
};