import { pingPostgres } from "$lib/server/postgresql/db";
import { pingRedis } from "$lib/server/redis/db";

export async function GET() {
    try {
        const db1 = await pingPostgres();
        const db2 = await pingRedis();

        if (db1 && db2) {
            return new Response(JSON.stringify({status: 'ok'}), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        } else {
            return new Response(JSON.stringify({status: 'error'}), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        }
    } catch (_) {
        return new Response(JSON.stringify({status: 'error'}), {
            status: 500,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }
}