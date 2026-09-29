// Minimal JSON Schema (2020-12 subset) checker for the contract tests: type (incl. arrays with "null"), enum, const,
// properties/required/additionalProperties:false, items, min/max(Length/Items/imum), pattern, $ref to #/$defs, oneOf.
// Exactly the keywords contracts/my-reports/my-reports-v1.schema.json uses; an unknown keyword fails loudly.
type Schema = Record<string, any>;
const KNOWN = new Set(['$schema', '$id', 'title', 'description', '$defs', '$ref', 'type', 'enum', 'const', 'properties', 'required',
  'additionalProperties', 'items', 'minimum', 'maximum', 'minLength', 'maxLength', 'maxItems', 'pattern', 'oneOf', 'format']);

function typeOk(t: string, v: unknown): boolean {
  switch (t) {
    case 'null': return v === null;
    case 'string': return typeof v === 'string';
    case 'boolean': return typeof v === 'boolean';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'object': return !!v && typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    default: throw new Error(`unknown type ${t}`);
  }
}

export function validate(schema: Schema, value: unknown, root: Schema = schema, path = '$'): string[] {
  for (const k of Object.keys(schema)) if (!KNOWN.has(k)) throw new Error(`unsupported keyword ${k} at ${path}`);
  if (schema.$ref) {
    const name = /^#\/\$defs\/(.+)$/.exec(schema.$ref)?.[1];
    if (!name || !root.$defs?.[name]) throw new Error(`bad $ref ${schema.$ref}`);
    return validate(root.$defs[name], value, root, path);
  }
  const errs: string[] = [];
  if (schema.oneOf) {
    const ok = (schema.oneOf as Schema[]).filter((s) => validate(s, value, root, path).length === 0).length;
    if (ok !== 1) errs.push(`${path}: oneOf matched ${ok}`);
    return errs;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t: string) => typeOk(t, value))) return [`${path}: expected ${types.join('|')}`];
  }
  if (schema.const !== undefined && value !== schema.const) errs.push(`${path}: expected const ${schema.const}`);
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: ${JSON.stringify(value)} not in enum`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) errs.push(`${path}: too short`);
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) errs.push(`${path}: too long`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errs.push(`${path}: pattern ${schema.pattern}`);
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) errs.push(`${path}: not a date-time`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${path}: < ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${path}: > ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${path}: too many items`);
    if (schema.items) value.forEach((v, i) => errs.push(...validate(schema.items, v, root, `${path}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const r of schema.required ?? []) if (!(r in obj)) errs.push(`${path}: missing ${r}`);
    for (const [k, v] of Object.entries(obj)) {
      if (schema.properties?.[k]) errs.push(...validate(schema.properties[k], v, root, `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}: unexpected ${k}`);
    }
  }
  return errs;
}
