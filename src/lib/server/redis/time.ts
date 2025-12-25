import { redis } from "$lib/server/redis/db";

export class TimeService {
    private static useRedisTime = true;

    static async now(): Promise<number> {
        if (this.useRedisTime) {
            const [seconds, microseconds] = await redis.time();
            return seconds * 1000 + Math.floor(microseconds / 1000);
        }
        return Date.now();
    }

    // language=Lua
    // static readonly GET_TIME_LUA = `
    //     local time = redis.call('TIME')
    //     local now = time[1] * 1000 + math.floor(time[2] / 1000)
    // `;
}

export function updateSessionTime(status: "pre" | "regular" | "post" | "closed") {
    // language=Lua
    const script = `
        local time = redis.call('TIME')
        local now = time[1] * 1000 + math.floor(time[2] / 1000)
        
        local key = 'exchange:session'
        local score = math.floor(now / 1000) * 1000 
        local value = tonumber(ARGV[1])
    
        local last = redis.call('ZRANGE', key, -1, -1)
        if #last > 0 then
            local last_id = tonumber(last[1]:match('^(%d+):'))
            if last_id == value then
                return 0
            end
        end
    
        redis.call('ZADD', key, score, value .. ':' .. tostring(score))
    `;

    const id = {
        "pre": 0,
        "regular": 1,
        "post": 2,
        "closed": 3
    } as const;

    return redis.eval(script, 0, id[status].toString());
}