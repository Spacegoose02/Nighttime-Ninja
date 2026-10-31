// Request shapes, checked by Fastify before a handler runs. A wrong type (a list where a number belongs, say) is
// turned away with a 400 that names the field, instead of reaching the database as "[object Object]".
// Handlers still trim and cap text themselves; these guard the shape. Numbers and true/false sent as text
// ("2", "true") are accepted and converted, as forms and older app versions send them that way.
import type { FastifyInstance, FastifySchema, FastifyServerOptions } from 'fastify';

type Prop = Record<string, unknown>;

export const text: Prop = { type: ['string', 'null'] };
export const number: Prop = { type: ['number', 'null'] };
export const flag: Prop = { type: 'boolean' };
export const date: Prop = { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
export const oneOf = (...values: string[]): Prop => ({ type: 'string', enum: values });
export const list = (items: Prop = text, maxItems = 500): Prop => ({ type: 'array', items, maxItems });

/** A JSON body with these fields. Unknown fields are left alone so older and newer apps keep working. */
export function body(properties: Record<string, Prop>, required: string[] = []): FastifySchema {
  return { body: { type: ['object', 'null'], properties, ...(required.length ? { required } : {}) } };
}

/**
 * Every route that takes a body gets at least "it's an object", so a stray list or bare string never reaches a
 * handler that reads fields off it. Routes with their own schema keep theirs.
 */
export function requireObjectBodies(app: FastifyInstance): void {
  app.addHook('onRoute', (route) => {
    const methods = ([] as string[]).concat(route.method);
    if (!methods.some((m) => m === 'POST' || m === 'PUT' || m === 'PATCH')) return;
    route.schema ??= {};
    route.schema.body ??= { type: ['object', 'null'] };
  });
}

const A = { string: 'text', number: 'a number', boolean: 'true or false', object: 'a set of fields', array: 'a list', integer: 'a whole number' } as Record<string, string>;

/** Turns a schema miss into a sentence a person can act on: "quantity should be a number". */
export const schemaErrorFormatter: NonNullable<FastifyServerOptions['schemaErrorFormatter']> = (errors) => {
  const e = errors[0];
  const field = e.instancePath.split('/').filter(Boolean).join('.') || 'The request';
  let message: string;
  if (e.keyword === 'type') {
    const types = ([] as string[]).concat((e.params as { type: string | string[] }).type).filter((t) => t !== 'null');
    message = `${field} should be ${types.map((t) => A[t] ?? t).join(' or ')}`;
  } else if (e.keyword === 'required') {
    message = `${(e.params as { missingProperty: string }).missingProperty} is required`;
  } else if (e.keyword === 'enum') {
    message = `${field} should be one of: ${(e.params as { allowedValues: string[] }).allowedValues.join(', ')}`;
  } else if (e.keyword === 'pattern' && field !== 'The request') {
    message = `${field} isn't in the right format`;
  } else {
    message = `${field} ${e.message ?? 'is not valid'}`;
  }
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = 400;
  return err;
};
