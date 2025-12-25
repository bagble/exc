export interface SSEConnectionConfig {
    url: string;
    events: string[];
    maxReconnectAttempts?: number;
}

export class SSEConnection {
    private connection: EventSource | null = null;
    private manualDisconnect = false;
    private connectionState = 'disconnected';
    private reconnectAttempts = 0;
    private readonly maxReconnectAttempts: number;
    private readonly currentUrl: string;
    private events: string[];

    constructor(config: SSEConnectionConfig) {
        this.currentUrl = config.url;
        this.events = config.events;
        this.maxReconnectAttempts = config.maxReconnectAttempts || 10;
    }

    connect() {
        if (this.connection) {
            console.log('Cleaning up existing connection');
            this.cleanup();
        }

        this.connection = new EventSource(this.currentUrl);

        this.connection.onopen = () => {
            this.manualDisconnect = false;
        };

        this.connection.onerror = () => {
            if (this.connection?.readyState === EventSource.CLOSED) {
                this.handleReconnect();
            }
        };

        this.setupEventListeners();
    }

    private setupEventListeners() {
        if (!this.connection) return;

        // 공통 이벤트 설정
        this.connection.addEventListener('connected', () => {
            this.connectionState = 'connected';
            this.reconnectAttempts = 0;
            this.onMessage({ type: 'connectionState', data: 'connected' });
        });

        this.connection.addEventListener('error', (event) => {
            const data = (event as MessageEvent).data;
            if (data && data !== 'undefined') {
                try {
                    this.onMessage({
                        type: 'error',
                        data: JSON.parse(data)
                    });
                } catch (e) {
                    console.error('Failed to parse error data:', data, e);
                    this.onMessage({
                        type: 'error',
                        message: data
                    });
                }
            }
        });

        // 커스텀 이벤트들 설정
        this.events.forEach(eventName => {
            this.connection!.addEventListener(eventName, (event) => {
                this.onMessage({
                    type: eventName,
                    data: JSON.parse((event as MessageEvent).data)
                });
            });
        });
    }

    private handleReconnect() {
        this.cleanup();

        if (!this.manualDisconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            const delay = this.getBackoffDelay(this.reconnectAttempts);
            console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);

            setTimeout(() => {
                this.connectionState = 'connecting';
                this.onMessage({ type: 'connectionState', state: 'connecting' });
                this.reconnectAttempts++;
                this.connect();
            }, delay);
        } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.onMessage({
                type: 'error',
                message: 'Max reconnection attempts reached'
            });
        }
    }

    private getBackoffDelay(attempt: number): number {
        const base = 1000; // 1초
        const max = 10000; // 10초
        const jitter = Math.random() * 1000;
        return Math.min(base * Math.pow(2, attempt) + jitter, max);
    }

    disconnect() {
        this.cleanup();
    }

    private cleanup() {
        this.manualDisconnect = true;

        if (this.connection && this.connectionState !== 'disconnected') {
            this.connection.close();
            this.connection = null;
            this.connectionState = 'disconnected';
            this.onMessage({ type: 'connectionState', state: 'disconnected' });
        }
    }

    onMessage(data: any) {
        self.postMessage(data);
    }
}