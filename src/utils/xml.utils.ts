/**
 * XML and SOAP support.
 *
 * Plenty of production APIs still speak XML — SOAP services, RSS/Atom feeds,
 * sitemaps, legacy partner integrations. Rather than teach the response
 * wrapper about XML directly, it delegates here, so a project that never
 * touches XML simply never imports this module.
 */
import { XMLParser } from 'fast-xml-parser';
import type { UnknownRecord } from '../types';
import { readPath } from './jsonpath.utils';

/**
 * Attributes are prefixed with `@` and text content is exposed as `#text`, so
 * a parsed document can be walked with the same dotted paths used for JSON.
 */
const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  trimValues: true,
  parseAttributeValue: true,
  /* Namespace prefixes are stripped so `soap:Envelope` reads as `Envelope`;
   * assertions should not have to know which prefix the server chose today. */
  removeNSPrefix: true,
} as const;

const parser = new XMLParser(PARSER_OPTIONS);

/** Parses an XML document into a plain object. */
export function parseXml(xml: string): UnknownRecord {
  return parser.parse(xml) as UnknownRecord;
}

/**
 * Serialises an object back to XML — used to build SOAP request bodies.
 *
 * Written by hand rather than taken from the parser package, whose builder is
 * deprecated in favour of a separate dependency. The rules mirror the parser's:
 * a key beginning with `@` becomes an attribute, `#text` becomes the element's
 * text, an array repeats its element, and everything else nests.
 */
export function buildXml(value: unknown, indent = ''): string {
  if (!isRecord(value)) return escapeXml(asText(value));

  const lines: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('@') || key === '#text') continue;
    for (const item of Array.isArray(child) ? (child as unknown[]) : [child]) {
      lines.push(element(key, item, indent));
    }
  }
  return lines.join('\n');
}

/** Renders one element, with its attributes, text and children. */
function element(name: string, value: unknown, indent: string): string {
  if (!isRecord(value)) return `${indent}<${name}>${escapeXml(asText(value))}</${name}>`;

  const attributes = Object.entries(value)
    .filter(([key]) => key.startsWith('@'))
    .map(([key, attribute]) => ` ${key.slice(1)}="${escapeXml(asText(attribute))}"`)
    .join('');

  const text = value['#text'];
  if (text !== undefined) {
    return `${indent}<${name}${attributes}>${escapeXml(asText(text))}</${name}>`;
  }

  const inner = buildXml(value, `${indent}  `);
  if (!inner) return `${indent}<${name}${attributes} />`;
  return `${indent}<${name}${attributes}>\n${inner}\n${indent}</${name}>`;
}

/** The five characters XML reserves. Escaping them is not optional. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a dotted path out of a parsed document, e.g. `Envelope.Body.Result`. */
export function xmlPath(xml: string, path: string): unknown {
  return readPath(parseXml(xml), path);
}

/** True when a body looks like XML, so the response wrapper can pick a parser. */
export function looksLikeXml(body: string): boolean {
  return /^\s*<\?xml|^\s*<[a-zA-Z_:]/.test(body);
}

/** The `<Body>` of a SOAP envelope, with the envelope boilerplate removed. */
export function soapBody(xml: string): unknown {
  return readPath(parseXml(xml), 'Envelope.Body');
}

/**
 * A SOAP `<Fault>` when the response carries one.
 *
 * SOAP reports application errors with HTTP 500 and a fault in the body, so a
 * status assertion alone will not tell you what went wrong — this will.
 */
export interface SoapFault {
  readonly code: string;
  readonly message: string;
  readonly detail?: unknown;
}

export function soapFault(xml: string): SoapFault | undefined {
  const fault = readPath(parseXml(xml), 'Envelope.Body.Fault');
  if (!fault || typeof fault !== 'object') return undefined;
  const record = fault as UnknownRecord;
  /* SOAP 1.1 uses faultcode/faultstring; 1.2 uses Code/Reason. Both are read
   * so the same helper works against either version of a service. */
  return {
    code: asText(record.faultcode ?? readPath(record, 'Code.Value')) || 'unknown',
    message: asText(record.faultstring ?? readPath(record, 'Reason.Text')),
    detail: record.detail ?? record.Detail,
  };
}

/** Wraps a payload in a SOAP 1.1 envelope ready to POST. */
export function soapEnvelope(body: unknown, namespaces: Record<string, string> = {}): string {
  const attributes: UnknownRecord = {
    '@xmlns:soap': 'http://schemas.xmlsoap.org/soap/envelope/',
  };
  for (const [prefix, uri] of Object.entries(namespaces)) attributes[`@xmlns:${prefix}`] = uri;
  return buildXml({ 'soap:Envelope': { ...attributes, 'soap:Body': body } });
}

/** Renders a parsed node as text without stringifying an object into a message. */
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}
