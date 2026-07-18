import { beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { ROOM_GUARD_SQL } from '../src/utils/roomGuard.js';
import type { FastifyInstance } from 'fastify';

/**
 * Wraps a mocked pg.Pool so the room-guard query (authenticate preHandler /
 * WS write gate) is answered by `guardQuery` instead of consuming the test's
 * `mockResolvedValueOnce` stack on `mockDb.query`. Default guard result is an
 * empty row set (room row absent → guard passes / room treated as unlocked).
 */
export function wrapDbWithGuardDispatch(
  mockDb: any,
  guardQuery: (...args: unknown[]) => Promise<any> = async () => ({ rows: [], rowCount: 0 })
) {
  return {
    query: (...args: unknown[]) => (args[0] === ROOM_GUARD_SQL ? guardQuery(...args) : mockDb.query(...args)),
    connect: (...args: unknown[]) => mockDb.connect(...args),
  };
}

export function setupTestApp() {
    const context: {
        app: FastifyInstance | undefined;
        roomId: string;
        token: string | undefined;
        mockDb: any;
        /**
         * Rows returned for the room-guard query (`ROOM_GUARD_SQL`) issued by
         * the authenticate preHandler and the WS write-access check. The guard
         * query is dispatched here instead of `mockDb.query`, so per-test
         * `mockResolvedValueOnce` stacks are never consumed by it. Defaults to
         * an empty result (room row absent → guard passes / unlocked).
         */
        guardRows: any[];
        guardQuery: any;
    } = {
        app: undefined,
        roomId: 'test-room-id',
        token: undefined,
        mockDb: undefined,
        guardRows: [],
        guardQuery: undefined,
    };

    beforeEach(async () => {
        context.guardRows = [];
        context.guardQuery = vi.fn(async () => ({ rows: context.guardRows, rowCount: context.guardRows.length }));
        context.mockDb = {
            query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
            connect: vi.fn().mockResolvedValue({
              query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
              release: vi.fn(),
            }),
        };
        const dispatchDb = wrapDbWithGuardDispatch(context.mockDb, (...args) => context.guardQuery(...args));
        context.app = await buildApp({ db: dispatchDb as any, disableRateLimit: true, jwtSecret: 'test-secret' });
        await context.app.ready();

        context.token = context.app.jwt.sign({ roomId: context.roomId });
    });

    afterEach(async () => {
        if (context.app) {
            await context.app.close();
        }
    });

    return context;
}
