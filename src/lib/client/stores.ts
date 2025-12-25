import { writable } from "svelte/store";

export const sessionStore = writable<any>({
    session: null
});
export const infoStore = writable<any>({
    "symbol": null,
    "name": null,
    "detail": null,
    "url": null,
    "logo": null,
    "market": null,
    "type": null,
    "minimum_order_quantity": null,
    "tick_size": null,
    "total_shares": null,
    "ipo_price": null,
    "tags": [],
    "status": {
        "reason": null,
        "status": null,
    }
});
export const depthStore = writable<any>({
    type: null,
    updateId: null,
    depth: {
        bids: [],
        asks: []
    }
});
export const ledgerStore = writable<any>({
    type: null,
    ledger: []
});
export const chartStore = writable<any>({
    type: null,
    interval: null,
    updateId: null,
    chart: []
});

export const order = writable({
    symbol: '',
    method: 'create',
    order_id: '',
    type: 'limit',
    price: null,
    quantity: null,
})

export function clearStores() {
    sessionStore.set({
        session: null
    });
    infoStore.set({
        "symbol": null,
        "name": null,
        "detail": null,
        "url": null,
        "logo": null,
        "market": null,
        "type": null,
        "minimum_order_quantity": null,
        "tick_size": null,
        "total_shares": null,
        "ipo_price": null,
        "tags": [],
        "status": {
            "reason": null,
            "status": null,
        }
    });
    depthStore.set({
        type: null,
        updateId: null,
        depth: {
            bids: [],
            asks: []
        }
    });
    ledgerStore.set({
        type: null,
        ledger: []
    });
    chartStore.set({
        type: null,
        interval: null,
        updateId: null,
        chart: []
    });

    order.set({
        symbol: '',
        method: 'create',
        order_id: '',
        type: 'limit',
        price: null,
        quantity: null,
    });
}