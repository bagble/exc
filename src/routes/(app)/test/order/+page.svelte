<script lang="ts">
    import {safe} from "@orpc/client";
    import {rpc} from "$lib/client/rpc";

    let { symbol, method, order_id, type, price, quantity } = $state({
        symbol: '',
        method: 'create',
        order_id: '',
        type: 'limit',
        price: null,
        quantity: null,
    });

    function resetForm() {
        // symbol = '';
        // order_id = '';
        // type = 'limit';
        // price = null;
        // quantity = null;
    }

    async function handleSubmit(event: Event, side?: string) {
        event.preventDefault();
        if (method === 'create' && (!symbol || !type || !quantity || (type === 'limit' && !price) || !side)) {
            let missingFields = [];
            if (!symbol) missingFields.push('Symbol');
            if (!type) missingFields.push('Type');
            if (type === 'limit' && !price) missingFields.push('Price');
            if (!quantity) missingFields.push('Quantity');
            if (!side) missingFields.push('Side (Buy/Sell)');
            alert(`Cannot create order. Please provide: ${missingFields.join(', ')}`);
            return;
        }
        if (method === 'modify' && (!order_id || (!price && !quantity))) {

            let missingFields = [];
            if (!order_id) missingFields.push('Order ID');
            if (!price && !quantity) missingFields.push('Price or Quantity');
            alert(`Cannot modify order. Please provide: ${missingFields.join(', ')}`);
            return;
        }
        if (method === 'cancel' && !order_id) {
            alert('Please provide the order ID to cancel an order.');
            return;
        }

        switch (method) {
            case 'create':
                const { data, error } = await safe(
                    rpc.orders.create({
                        symbol,
                        type: type as 'limit' | 'market',
                        price: price ? price : 0,
                        quantity: quantity!,
                        side: side as 'buy' | 'sell',
                    })
                );

                if (error) {
                    console.error('Error creating order:', error);
                } else {
                    resetForm();
                }
                break;
            case 'modify':
                const { error: modifyError } = await safe(
                    rpc.orders.modify({
                        symbol,
                        order_id,
                        type: type as 'limit' | 'market',
                        price: price ? price : 0,
                        quantity: quantity!
                    })
                );

                if (modifyError) {
                    console.error('Error modifying order:', modifyError);
                } else {
                    resetForm();
                }
                break;
            case 'cancel':
                const { error: cancelError } = await safe(
                    rpc.orders.cancel({ symbol, order_id })
                );

                if (cancelError) {
                    console.error('Error canceling order:', cancelError);
                } else {
                    resetForm();
                }
                break;
            default:
                alert('Invalid method selected.');
                break;
        }
    }
</script>

<form class="flex flex-col gap-2 border p-4 rounded w-max">
    <input type="text" name="symbol" placeholder="Enter symbol" class="block w-80 rounded transition outline-0" bind:value={symbol}/>
    <select name="method" class="block w-80 rounded transition outline-0" bind:value={method}>
        <option value="create">Create</option>
        <option value="modify">Modify</option>
        <option value="cancel">Cancel</option>
    </select>
    <input type="text" name="order_id" placeholder="Enter order id" class="block w-80 rounded disabled:bg-gray-200 transition outline-0" bind:value={order_id} disabled={method === 'create'}/>
    <select name="type" class="block w-80 rounded disabled:bg-gray-200 transition outline-0" bind:value={type} disabled={method === 'cancel'}>
        <option value="limit">Limit</option>
        <option value="market">Market</option>
        <!--                <option value="stop">Stop (not supported)</option>-->
        <!--                <option value="stop_limit">Stop Limit (not supported)</option>-->
    </select>
    <input type="number" name="price" placeholder="Enter price" class="block w-80 rounded disabled:bg-gray-200 transition outline-0" bind:value={price} disabled={type === 'market' || method === 'cancel'}/>
    <input type="number" name="quantity" placeholder="Enter quantity" class="block w-80 rounded disabled:bg-gray-200 transition outline-0" bind:value={quantity} disabled={method === 'cancel'}/>
    {#if method === 'create'}
        <div class="flex gap-4">
            <button type="submit" onclick={(e) => handleSubmit(e, 'buy')}
                    class="w-38 h-10 bg-green-500 text-white rounded hover:bg-green-600 transition outline-0">
                Buy
            </button>
            <button type="submit" onclick={(e) => handleSubmit(e, 'sell')}
                    class="w-38 h-10 bg-red-500 text-white rounded hover:bg-red-600 transition outline-0">
                Sell
            </button>
        </div>
    {:else if method === 'modify'}
        <button type="submit" onclick={(e) => handleSubmit(e)}
                class="w-80 h-10 bg-yellow-500 text-white rounded hover:bg-yellow-600 transition outline-0">
            Modify
        </button>
    {:else if method === 'cancel'}
        <button type="submit" onclick={(e) => handleSubmit(e)}
                class="w-80 h-10 bg-gray-500 text-white rounded hover:bg-gray-600 transition outline-0">
            Cancel
        </button>
    {/if}
</form>