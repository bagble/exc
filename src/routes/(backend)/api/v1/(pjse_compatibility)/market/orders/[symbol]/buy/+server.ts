import {getServerORPC} from "$lib/server/rpc/orpc.server";

export async function POST({ request, params: { symbol }}) {
    const body = await request.json();

    const { type, price, quantity } = body

    try {
        const order = await getServerORPC({
            user: {
                id: 1,
                level: 5,
                emailVerified: true
            }
        }).orders.create({
            symbol,
            type,
            side: "buy",
            price: price || 0,
            quantity
        })

        return new Response(JSON.stringify({
            success: true,
            order: order
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }
}

export async function DELETE({ request, params: { symbol }}) {
    const body = await request.json();

    const { order_id } = body

    try {
        const order = await getServerORPC({
            user: {
                id: 1,
                level: 5,
                emailVerified: true
            }
        }).orders.cancel({
            symbol,
            order_id
        })

        return new Response(JSON.stringify({
            success: true,
            order: order
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }
}