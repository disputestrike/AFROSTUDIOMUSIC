/**
 * IDENTITY-WAVE TEST KIT (2026-07-20) — shared by test-rbac.mjs,
 * test-tenants.mjs, and test-pictures.mjs.
 *
 * Boots the REAL route modules on a bare Fastify instance (the
 * test-tenant-surface-isolation pattern) with:
 *   - a simulated authenticated identity per request (x-test-role /
 *     x-test-user / x-test-workspace headers), so every role in the ladder
 *     can knock on every gate;
 *   - an IN-MEMORY prisma: the real @afrohit/db client instance has its model
 *     delegates replaced (Object.defineProperty), so the routes run their
 *     actual queries against seeded rows — workspace scoping is exercised for
 *     real, not asserted from source text.
 *
 * No Postgres, no Redis, no provider keys.
 */
import { prisma } from '@afrohit/db';

let idCounter = 0;
export const nextId = (prefix = 'id') => `${prefix}_${++idCounter}`;

/** Minimal `where` matcher covering the operators the exercised routes use. */
function matches(row, where = {}) {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      if (!cond.some((sub) => matches(row, sub))) return false;
      continue;
    }
    if (key === 'AND') {
      if (!cond.every((sub) => matches(row, sub))) return false;
      continue;
    }
    const value = row[key];
    if (cond === null) {
      if (value !== null && value !== undefined) return false;
      continue;
    }
    if (cond instanceof Date) {
      if (!(value instanceof Date) || +value !== +cond) return false;
      continue;
    }
    if (typeof cond === 'object') {
      // Composite unique key (e.g. workspaceId_userId: {workspaceId, userId})
      // — the sub-keys are row columns, not operators.
      const ops = Object.keys(cond);
      const OPERATORS = ['in', 'not', 'gt', 'gte', 'lt', 'lte', 'startsWith', 'contains', 'some', 'none', 'equals'];
      if (ops.some((op) => OPERATORS.includes(op))) {
        if ('equals' in cond && value !== cond.equals) return false;
        if ('in' in cond && !cond.in.includes(value)) return false;
        if ('not' in cond) {
          if (cond.not === null ? value == null : value === cond.not) return false;
        }
        if ('gt' in cond && !(value > cond.gt)) return false;
        if ('gte' in cond && !(value >= cond.gte)) return false;
        if ('lt' in cond && !(value < cond.lt)) return false;
        if ('lte' in cond && !(value <= cond.lte)) return false;
        if ('startsWith' in cond && !(typeof value === 'string' && value.startsWith(cond.startsWith))) return false;
        if ('contains' in cond && !(typeof value === 'string' && value.includes(cond.contains))) return false;
        // some/none relation filters: permissive (test data stays flat).
        continue;
      }
      if (value && typeof value === 'object') {
        // Nested relation object on the row (e.g. workspace: {...}).
        if (!matches(value, cond)) return false;
        continue;
      }
      // Composite unique: compare each sub-key against the row directly.
      if (!matches(row, cond)) return false;
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

function applyOrder(rows, orderBy) {
  if (!orderBy) return rows;
  const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
  const sorted = [...rows];
  for (const order of orders.reverse()) {
    const [field, dirRaw] = Object.entries(order)[0] ?? [];
    if (!field) continue;
    if (typeof dirRaw === 'object') continue; // relation ordering — keep insertion order
    const dir = dirRaw === 'desc' ? -1 : 1;
    sorted.sort((a, b) => (a[field] > b[field] ? dir : a[field] < b[field] ? -dir : 0));
  }
  return sorted;
}

/** An in-memory model delegate. Rows are plain objects; `include`/`select`
 *  return the whole row (routes only read fields the seeds define). */
export function fakeModel(rows = []) {
  const model = {
    rows,
    async findMany(args = {}) {
      let out = applyOrder(rows.filter((r) => matches(r, args.where)), args.orderBy);
      if (args.take) out = out.slice(0, args.take);
      return out.map((r) => ({ ...r }));
    },
    async findFirst(args = {}) {
      const out = applyOrder(rows.filter((r) => matches(r, args.where)), args.orderBy);
      return out.length ? { ...out[0] } : null;
    },
    async findUnique(args = {}) {
      return model.findFirst(args);
    },
    async findFirstOrThrow(args = {}) {
      const row = await model.findFirst(args);
      if (!row) throw Object.assign(new Error('NotFoundError'), { code: 'P2025', statusCode: 404 });
      return row;
    },
    async findUniqueOrThrow(args = {}) {
      return model.findFirstOrThrow(args);
    },
    async count(args = {}) {
      return rows.filter((r) => matches(r, args.where)).length;
    },
    async create(args) {
      const row = { id: nextId('row'), createdAt: new Date(), ...args.data };
      rows.push(row);
      return { ...row };
    },
    async update(args) {
      const row = rows.find((r) => matches(r, args.where));
      if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
      Object.assign(row, args.data);
      return { ...row };
    },
    async updateMany(args) {
      const hit = rows.filter((r) => matches(r, args.where));
      for (const row of hit) Object.assign(row, args.data);
      return { count: hit.length };
    },
    async upsert(args) {
      const row = rows.find((r) => matches(r, args.where));
      if (row) {
        Object.assign(row, args.update);
        return { ...row };
      }
      return model.create({ data: args.create });
    },
    async delete(args) {
      const index = rows.findIndex((r) => matches(r, args.where));
      if (index < 0) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
      const [row] = rows.splice(index, 1);
      return { ...row };
    },
    async deleteMany(args) {
      const hit = rows.filter((r) => matches(r, args.where));
      for (const row of hit) rows.splice(rows.indexOf(row), 1);
      return { count: hit.length };
    },
  };
  return model;
}

/** Replace prisma model delegates with in-memory fakes. `stores` maps model
 *  name → seed rows; returns the fakes so tests can inspect the data. */
export function installFakePrisma(stores) {
  const fakes = {};
  for (const [name, seed] of Object.entries(stores)) {
    fakes[name] = fakeModel(seed);
    Object.defineProperty(prisma, name, { value: fakes[name], configurable: true });
  }
  Object.defineProperty(prisma, '$transaction', {
    configurable: true,
    value: async (fnOrArray) =>
      typeof fnOrArray === 'function' ? fnOrArray(prisma) : Promise.all(fnOrArray),
  });
  Object.defineProperty(prisma, '$queryRaw', {
    configurable: true,
    value: async () => [],
  });
  return fakes;
}

/** Bare Fastify app: zod compilers + simulated per-request identity. */
export async function buildApp() {
  const { default: Fastify } = await import('fastify');
  const { validatorCompiler, serializerCompiler } = await import('fastify-type-provider-zod');
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('preValidation', async (req) => {
    const role = req.headers['x-test-role'];
    if (!role) return; // no header = unauthenticated (public routes only)
    req.auth = {
      userId: String(req.headers['x-test-user'] ?? 'user-A'),
      workspaceId: String(req.headers['x-test-workspace'] ?? 'ws-A'),
      role: String(role),
      isService: false,
    };
  });
  return app;
}

/** Convenience inject with the simulated identity headers. */
export function as(role, extra = {}) {
  return {
    'x-test-role': role,
    'x-test-user': extra.userId ?? 'user-A',
    'x-test-workspace': extra.workspaceId ?? 'ws-A',
    'x-afrohit-request': '1',
    ...(extra.headers ?? {}),
  };
}
