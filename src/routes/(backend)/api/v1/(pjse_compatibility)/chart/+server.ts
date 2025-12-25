import { getServerORPC } from "$lib/server/rpc/orpc.server";
import { getSupportedIntervals } from "../../../../../../utils/timestamp";

export async function GET({ url }) {
    const symbol = url.searchParams.get('symbol') || ''
    const interval = url.searchParams.get('interval') || '1D'
    const before = url.searchParams.get('before') || Date.now().toString()
    let count = url.searchParams.get('count') || '100'

    if (!getSupportedIntervals(0).includes(interval)) {
        return new Response(JSON.stringify({ error: 'Invalid interval' }), {
            headers: {
                'Content-Type': 'application/json'
            },
            status: 400
        });
    }

    if (parseInt(count) > 5000) {
        count = '5000'
    }

    const result = await getServerORPC().chart.getTop({
        symbol,
        timestamp: parseInt(before),
        interval: interval as any,
        count: parseInt(count)
    })
    return new Response(JSON.stringify(result), {
        headers: {
            'Content-Type': 'application/json'
        },
        status: 200
    });
}