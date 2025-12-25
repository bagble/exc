import type { Unsafe } from "sveltekit-sse";
import { logger } from "../../utils/logger";

interface ClientEmitter {
    emit: (eventName: string, data: string) => Unsafe<any, Error>;
    sessionID: string;
}

const dataClients: { [symbol: string]: Map<string, { ClientEmitter: ClientEmitter, data: any }> } = {}; // sessionId -> Connection
const notifyClients: { [symbol: string]: Map<string, { ClientEmitter: ClientEmitter, data: any }> } = {}; // userId -> Connection

/**
 * Data 클라이언트에 등록된 모든 클라이언트를 반환합니다.
 * @return dataClients - 심볼에 연결된 모든 Data 클라이언트 맵
 */
export function getDataClients() {
    return dataClients;
}

/**
 * 특정 심볼에 Data 클라이언트를 추가합니다.
 * @param symbol - 심볼
 * @param client - 추가할 클라이언트 객체
 * @param initialData - 클라이언트와 연결된 초기 데이터 (기본값: 빈 객체)
 */
export function addDataClient(symbol: string, client: ClientEmitter, initialData: any = {}) {
    if (!dataClients[symbol]) {
        dataClients[symbol] = new Map();
    }
    dataClients[symbol].set(client.sessionID, {ClientEmitter: client, data: initialData});
}

/**
 * 특정 심볼에 연결된 클라이언트를 제거합니다.
 * @param symbol - 심볼
 * @param client - 제거할 클라이언트 객체
 */
export function removeDataClient(symbol: string, client: ClientEmitter) {
    if (dataClients[symbol]) {
        dataClients[symbol].delete(client.sessionID);
        if (dataClients[symbol].size === 0) {
            delete dataClients[symbol];
        }
    }
}

/**
 * 심볼에 연결된 클라이언트가 있는지 확인합니다.
 * @param symbol - 심볼
 * @param includeThisData - 이 데이터를 포함하는 클라이언트가 있는지 확인 (빈 객체인 경우 모두 포함)
 * @returns 심볼에 연결된 클라이언트가 있으면 true, 없으면 false 반환 그리고 includeThisData가 빈 객체가 아니면 해당 데이터를 포함하는 클라이언트가 있는지 확인
 */
export function hasDataClient(symbol: string, includeThisData: {} = {}) {
    if (!dataClients[symbol]) return false;

    if (Object.keys(includeThisData).length === 0) {
        return dataClients[symbol].size > 0;
    } else {
        for (const [_, clientData] of dataClients[symbol]) {
            if (Object.entries(includeThisData).every(([key, value]) => clientData.data[key] === value)) {
                return true;
            }
        }
        return false;
    }
}

/**
 * 심볼에 연결된 모든 클라이언트에게 이벤트와 데이터를 전송합니다.
 * @param symbol - 심볼
 * @param eventName - 전송할 이벤트 이름
 * @param data - 전송할 데이터 (문자열)
 * @param includeThisData - 이 데이터를 포함하는 클라이언트에게만 전송 (빈 객체인 경우 모두에게 전송)
 */
export async function broadcastToDataClients(symbol: string, eventName: string, data: Uint8Array | string, includeThisData: {} = {}) {
    try {
        const sendData = typeof data === 'string' ? data : Buffer.from(data).toString('base64');
        const BATCH_SIZE = 100; // Number of clients to send in each batch

        let clients = Array.from(dataClients[symbol] || []);

        if (clients.length === 0) return; // No clients to send to

        // includeThisData가 빈 객체가 아니면 필터링
        if (Object.keys(includeThisData).length > 0) {
            clients = clients.filter(([_, clientData]) => {
                return Object.entries(includeThisData).every(([key, value]) => {
                    return clientData.data[key] === value;
                });
            });
        }

        for (let i = 0; i < clients.length; i += BATCH_SIZE) {
            const batch = clients.slice(i, i + BATCH_SIZE);

            await Promise.allSettled(
                batch.map(([sessionId, client]) => {
                    return new Promise<void>((resolve, reject) => {
                        try {
                            client.ClientEmitter.emit(eventName, sendData);
                            resolve();
                        } catch (error) {
                            logger.error(`Error sending data to client ${sessionId}. Removing client. Error: ${error} Data: ${data}`);
                            removeDataClient(symbol, client.ClientEmitter);
                            reject(error);
                        }
                    });
                })
            );

            if (i + BATCH_SIZE < clients.length) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }
    } catch (error) {
        // 클라이언트가 없는 듯
    }
}

/**
 * Notify 클라이언트에 등록된 모든 클라이언트를 반환합니다.
 * @return notifyClients - 유저ID에 연결된 모든 Notify 클라이언트 맵
 */
export function getNotifyClients() {
    return notifyClients;
}

/**
 * 특정 유저ID에 Notify 클라이언트를 추가합니다.
 * @param userID 유저 ID
 * @param client 추가할 Notify 클라이언트 객체
 * @param initialData 클라이언트와 연결된 초기 데이터 (기본값: 빈 객체)
 */
export function addNotifyClient(userID: number, client: ClientEmitter, initialData: any = {}) {
    if (!notifyClients[userID]) {
        notifyClients[userID] = new Map();
    }
    notifyClients[userID].set(client.sessionID, {ClientEmitter: client, data: initialData});
}

/**
 * 특정 유저ID에 연결된 Notify 클라이언트를 제거합니다.
 * @param userID 유저 ID
 * @param client 제거할 Notify 클라이언트 객체
 */
export function removeNotifyClient(userID: number, client: ClientEmitter) {
    if (notifyClients[userID]) {
        notifyClients[userID].delete(client.sessionID);
        if (notifyClients[userID].size === 0) {
            delete notifyClients[userID];
        }
    }
}

/**
 * 심볼에 연결된 클라이언트가 있는지 확인합니다.
 * @param userID - 유저 ID
 * @param includeThisData - 이 데이터를 포함하는 클라이언트가 있는지 확인 (빈 객체인 경우 모두 포함)
 * @returns 심볼에 연결된 클라이언트가 있으면 true, 없으면 false 반환 그리고 includeThisData가 빈 객체가 아니면 해당 데이터를 포함하는 클라이언트가 있는지 확인
 */
export function hasNotifyClient(userID: number, includeThisData: {} = {}) {
    if (!notifyClients[userID]) return false;

    if (Object.keys(includeThisData).length === 0) {
        return notifyClients[userID].size > 0;
    } else {
        for (const [_, client] of notifyClients[userID]) {
            if (Object.entries(includeThisData).every(([key, value]) => (client as any)[key] === value)) {
                return true;
            }
        }
        return false;
    }
}

/**
 * 특정 유저ID에 연결된 모든 클라이언트에게 이벤트와 데이터를 전송합니다.
 * @param userID 유저 ID
 * @param eventName 전송할 이벤트 이름
 * @param data 전송할 데이터 (문자열)
 * @param includeThisData 이 데이터를 포함하는 클라이언트에게만 전송 (빈 객체인 경우 모두에게 전송)
 */
export async function broadcastToNotifyClients(userID: number, eventName: string, data: Uint8Array | string, includeThisData: {} = {}) {
    try {
        const sendData = typeof data === 'string' ? data : Buffer.from(data).toString('base64');
        const BATCH_SIZE = 100; // Number of clients to send in each batch

        let clients = Array.from(notifyClients[userID] || []);

        if (clients.length === 0) return; // No clients to send to

        // includeThisData가 빈 객체가 아니면 필터링
        if (Object.keys(includeThisData).length > 0) {
            clients = clients.filter(([_, client]) => {
                return Object.entries(includeThisData).every(([key, value]) => {
                    return (client as any)[key] === value;
                });
            });
        }

        for (let i = 0; i < clients.length; i += BATCH_SIZE) {
            const batch = clients.slice(i, i + BATCH_SIZE);

            await Promise.allSettled(
                batch.map(([sessionId, client]) => {
                    return new Promise<void>((resolve, reject) => {
                        try {
                            client.ClientEmitter.emit(eventName, sendData);
                            resolve();
                        } catch (error) {
                            logger.error(`Error sending notify to client ${sessionId}. Removing client. Error: ${error} Data: ${data}`);
                            removeNotifyClient(userID, client.ClientEmitter);
                            reject(error);
                        }
                    });
                })
            );

            if (i + BATCH_SIZE < clients.length) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }
    } catch (error) {
        // 클라이언트가 없는 듯
    }
}