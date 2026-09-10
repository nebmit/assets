import { z } from 'zod';
export const PARSER_VERSION = 'arelle-2.43.1:1';
export const RESOLVER_VERSION = 1;
export const PARSER_CONFIG = { schemaVersion: 1, validate: true, formulas: false, offline: true, secTransformsRevision: '72033f579e89ab47e882437b5d4ceed9c7656ed5', calculations: 'c11r', memoryBytes: 2 * 1024 ** 3, timeoutMs: 300_000 } as const;
const dimension = z.object({ axis: z.string(), member: z.string().nullable(), typedValue: z.string().nullable(), default: z.boolean() });
const context = z.object({ id: z.string(), entity: z.string(), scheme: z.string(), start: z.string().nullable(), end: z.string().nullable(), instant: z.boolean(), dimensions: z.array(dimension), valid: z.boolean() });
const fact = z.object({ id: z.string(), concept: z.string(), context: z.string().nullable(), unit: z.string().nullable(), value: z.string().nullable(), nil: z.boolean(), numeric: z.boolean(), decimals: z.string().nullable(), precision: z.string().nullable(), valid: z.boolean(), document: z.string(), line: z.number().nullable() });
export const artifactSchema = z.object({ schemaVersion: z.literal(1), parserVersion: z.literal(PARSER_VERSION), facts: z.array(fact), contexts: z.array(context), units: z.record(z.object({ numerator: z.array(z.string()), denominator: z.array(z.string()) })), relationships: z.array(z.object({ arcrole: z.string(), role: z.string(), from: z.string(), to: z.string(), weight: z.string().nullable() })), diagnostics: z.array(z.object({ code: z.string(), severity: z.string(), message: z.string(), refs: z.array(z.string()) })) });
export type XbrlArtifact = z.infer<typeof artifactSchema>;
export type XbrlFact = XbrlArtifact['facts'][number];
export interface FilingPackage {
	schemaVersion: 1; accession: string; acceptedAt: string | null; submissionHash: string;
	entrypoints: string[]; documents: { url: string; hash: string; path: string; observedAt: string }[];
}
export class XbrlError extends Error {
	constructor(readonly code: string, message: string, readonly transient = false) { super(message); }
}
