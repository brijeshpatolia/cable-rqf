/**
 * Nominal typing. A branded type cannot be produced by accident — only by the
 * constructor that owns it. This is what stops a raw `number` from reaching the
 * cost engine (ARCHITECTURE.md §4, rule 4).
 */
declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };
