import type { SnapshotComparison } from '../types';
export interface RouteConfig {
    startRack: number | null;
    startEnd: 'low' | 'high';
    pairs: number[][];
}
export const defaultRoute: RouteConfig = { startRack: null, startEnd: 'low', pairs: [] };
export interface BookSku {
    sku: string;
    barcode: string;
    customer: string;
    name: string;
    qty: number;
    availableQty?: number;
    allocatedQty?: number;
    frozenQty?: number;
    eBarcode?: string;
}
export interface Risk {
    kind: 'multi' | 'similarCustomer' | 'variant' | 'nearby' | 'move';
    params: Record<string, string | number>;
}
export interface Target {
    location: string;
    category: 'CHANGED' | 'NEW_LOCATION' | 'EMPTIED_LOCATION';
    skus: BookSku[];
    risks: Risk[];
    changes: SnapshotComparison['locations'][number]['changes'];
}
export interface AuditPlan {
    comparison: SnapshotComparison;
    config: RouteConfig;
    targets: Target[];
    route: string[];
    special: string[];
}
export interface AuditLine {
    id: string;
    sku: string;
    barcode: string;
    actual: number | null;
    notes: string;
    isReturn?: boolean;
    returnCode?: string;
}
export interface AuditResult {
    lines: AuditLine[];
    notes: string;
    emptyConfirmed: boolean;
    completed: boolean;
    ignoredPhotoIds?: string[];
    photoLines?: Record<string,string>;
    revision: number;
    savedAt?: string;
    anomaly?: boolean;
}
export interface AuditPhoto {
    id: string;
    location: string;
    lineId: string;
}
export interface InspectionTaskBase {
    kind?: 'SKU';
    canEdit?: boolean;
    lifecycle?: 'DRAFT' | 'PUBLISHED' | 'WITHDRAWN' | 'DELETED';
    publicationRevision?: number;
    id:string;hall:string;createdAt:string;
    plan:{targets:Target[];route:string[];special:string[]};
    results:Record<string,AuditResult>;photos:AuditPhoto[];stale:boolean;
}
export interface AuditTask extends InspectionTaskBase {plan:AuditPlan}
export function blankResult(target: Target): AuditResult {
    return { lines: target.skus.map(s => ({ id: `book:${s.sku}`, sku: s.sku, barcode: s.barcode, actual: null, notes: '' })), notes: '', emptyConfirmed: false, completed: false, revision: 0 };
}
export function isAnomaly(target: Target, result: AuditResult): boolean {
    return result.lines.some(line => line.actual !== null && line.actual !== (target.skus.find(s => `book:${s.sku}` === line.id)?.qty || 0));
}
export function parseLocation(code: string): {
    rack: number;
    bay: number;
    level: number;
} | null {
    const match = /^(\d{3})-(\d{3})-(\d+)$/.exec(code);
    return match ? { rack: Number(match[1]), bay: Number(match[2]), level: Number(match[3]) } : null;
}
export function validateConfig(value: RouteConfig): RouteConfig {
    if (!value || !['low', 'high'].includes(value.startEnd) || !Array.isArray(value.pairs) || value.pairs.length > 100)
        throw new Error('INVALID_ROUTE');
    const seen = new Set<number>();
    for (const pair of value.pairs) {
        if (!Array.isArray(pair) || pair.length !== 2)
            throw new Error('INVALID_ROUTE');
        for (const rack of pair) {
            if (!Number.isInteger(rack) || rack < 0 || rack > 999 || seen.has(rack))
                throw new Error('INVALID_ROUTE');
            seen.add(rack);
        }
    }
    if (value.startRack !== null && (!Number.isInteger(value.startRack) || value.startRack < 0 || value.startRack > 999))
        throw new Error('INVALID_ROUTE');
    return { startRack: value.startRack, startEnd: value.startEnd, pairs: value.pairs };
}
export function rackPair(rack: number, config: RouteConfig): number[] {
    const custom = config.pairs.find(pair => pair.includes(rack));
    if (custom)
        return custom;
    const first = rack % 2 === 1 ? rack : rack - 1;
    // Racks reassigned by an exception are not silently paired a second time.
    return [first, first + 1].filter(r => !config.pairs.some(pair => pair.includes(r)));
}
export function snakeRoute(locations: string[], config: RouteConfig): {
    route: string[];
    special: string[];
} {
    validateConfig(config);
    const special: string[] = [], groups = new Map<string, {
        pair: number[];
        locations: string[];
    }>();
    const allRacks = new Set<number>();
    for (const code of [...new Set(locations)]) {
        const position = parseLocation(code);
        if (!position || position.level !== 1) {
            special.push(code);
            continue;
        }
        allRacks.add(position.rack);
        const pair = rackPair(position.rack, config), key = pair.join('/');
        if (!groups.has(key))
            groups.set(key, { pair, locations: [] });
        groups.get(key)!.locations.push(code);
    }
    // Include empty intermediate aisles in direction parity: skipping targets does not flip the physical route.
    const pairs = new Map<string, number[]>();
    const racks = [...allRacks];
    if (racks.length)
        for (let rack = Math.min(...racks); rack <= Math.max(...racks); rack++) {
            const pair = rackPair(rack, config);
            if (pair.length)
                pairs.set(pair.join('/'), pair);
        }
    const ordered = [...pairs.values()].sort((a, b) => Math.min(...a) - Math.min(...b));
    const start = config.startRack === null ? 0 : ordered.findIndex(pair => pair.includes(config.startRack!));
    if (start < 0)
        throw new Error('INVALID_START');
    const sequence = ordered.slice(start).concat(ordered.slice(0, start));
    const route: string[] = [];
    sequence.forEach((pair, index) => {
        const group = groups.get(pair.join('/'));
        if (!group)
            return;
        const ascending = (config.startEnd === 'low') === (index % 2 === 0);
        group.locations.sort((a, b) => {
            const x = parseLocation(a)!, y = parseLocation(b)!;
            return (ascending ? x.bay - y.bay : y.bay - x.bay) || pair.indexOf(x.rack) - pair.indexOf(y.rack);
        });
        route.push(...group.locations);
    });
    return { route, special: special.sort() };
}
// Restricted local resemblance: shared customer, long common code, or an explicit colour/size/box variant.
export function similarCode(a: string, b: string): boolean {
    if (a === b || Math.min(a.length, b.length) < 5)
        return false;
    const x = a.toUpperCase(), y = b.toUpperCase();
    let prefix = 0;
    while (prefix < Math.min(x.length, y.length) && x[prefix] === y[prefix])
        prefix++;
    let edits = Math.abs(x.length - y.length);
    if (x.length === y.length) {
        edits = 0;
        for (let i = 0; i < x.length; i++)
            if (x[i] !== y[i])
                edits++;
    }
    return (x.length === y.length && edits <= 2 && prefix >= Math.ceil(x.length * .5)) || prefix >= Math.ceil(Math.max(x.length, y.length) * .8);
}
function variantKey(sku: string): string {
    return sku.toUpperCase().replace(/(?:[-_](?:BLACK|WHITE|GREY|GRAY|RED|BLUE|GREEN|XL|XXL|XS|S|M|L|LEFT|RIGHT|\d+CM))$/, '').replace(/[（(]\d+\/\d+[）)]$/, '');
}
function nameVariant(name: string): string | null {
    const normalized = name.toLowerCase().replace(/(?:黑色|白色|灰色|红色|蓝色|绿色|左件|右件|左侧|右侧|\b(?:black|white|grey|gray|red|blue|green|left|right)\b|\d+(?:\.\d+)?\s*(?:cm|mm|英寸|寸|inch))/gi, ' ').replace(/\s+/g, ' ').trim();
    return normalized !== name.toLowerCase().replace(/\s+/g, ' ').trim() && normalized.length >= 3 ? normalized : null;
}
export function buildPlan(comparison: SnapshotComparison, stock: Array<BookSku & {
    location: string;
}>, config: RouteConfig): AuditPlan {
    validateConfig(config);
    const variantNames = new Map<string, Map<string, BookSku>>();
    const byLocation = new Map<string, BookSku[]>(), buckets = new Map<string, Map<string, {
        row: BookSku;
        location: string;
    }>>();
    for (const { location, ...row } of stock) {
        if (!byLocation.has(location))
            byLocation.set(location, []);
        byLocation.get(location)!.push(row);
        const baseName = nameVariant(row.name);
        if (baseName && row.customer) {
            const key = `${row.customer}\0${baseName}`;
            if (!variantNames.has(key))
                variantNames.set(key, new Map());
            const entries = variantNames.get(key)!;
            if (entries.size < 32 || entries.has(row.sku))
                entries.set(row.sku, row);
        }
        // Prefix bucket and length bound avoid all-SKU comparisons. Keep only a few representative distinct SKUs.
        if (row.customer && row.sku.length >= 5) {
            const key = `${row.customer}\0${row.sku.toUpperCase().slice(0, Math.ceil(row.sku.length * .5))}`;
            if (!buckets.has(key))
                buckets.set(key, new Map());
            const bucket = buckets.get(key)!;
            if (bucket.size < 32 || bucket.has(row.sku))
                bucket.set(row.sku, { row, location });
        }
    }
    const moves = new Map<string, {
        positive: Set<string>;
        negative: Set<string>;
    }>();
    for (const loc of comparison.locations)
        for (const change of loc.changes) {
            if (!moves.has(change.sku))
                moves.set(change.sku, { positive: new Set(), negative: new Set() });
            moves.get(change.sku)![change.differenceQty > 0 ? 'positive' : 'negative'].add(loc.locationCode);
        }
    const targets: Target[] = comparison.locations.map(loc => {
        const current = byLocation.get(loc.locationCode) || [];
        const skus = [...current, ...loc.changes.filter(c => !current.some(s => s.sku === c.sku)).map(c => ({ sku: c.sku, barcode: c.barcode, customer: '', name: c.nameZh, qty: 0 }))];
        const risks: Risk[] = [];
        if (current.length > 1)
            risks.push({ kind: 'multi', params: { count: current.length } });
        const near: BookSku[] = [];
        const position = parseLocation(loc.locationCode);
        const nearby = new Map<string, BookSku[]>();
        if (position && position.level === 1) {
            const pair = rackPair(position.rack, config);
            for (const rack of pair)
                for (const offset of [-1, 0, 1]) {
                    const code = `${String(rack).padStart(3, '0')}-${String(position.bay + offset).padStart(3, '0')}-1`;
                    if (code !== loc.locationCode) {
                        const rows = byLocation.get(code) || [];
                        nearby.set(code, rows);
                        near.push(...rows);
                    }
                }
        }
        for (const row of skus) {
            if (row.customer) {
                const key = `${row.customer}\0${row.sku.toUpperCase().slice(0, Math.ceil(row.sku.length * .5))}`;
                const match = [...(buckets.get(key)?.values() || [])].find(c => similarCode(row.sku, c.row.sku));
                if (match && !risks.some(r => r.kind === 'similarCustomer'))
                    risks.push({ kind: 'similarCustomer', params: { customer: row.customer, sku: row.sku, other: match.row.sku, location: match.location } });
            }
            const nameKey = nameVariant(row.name);
            const named = nameKey && row.customer ? [...(variantNames.get(`${row.customer}\0${nameKey}`)?.values() || [])].find(other => other.sku !== row.sku && other.name !== row.name) : undefined;
            const variant = named || [...current, ...near].find(other => other.sku !== row.sku && variantKey(row.sku) === variantKey(other.sku) && variantKey(row.sku).length >= 4);
            if (variant && !risks.some(r => r.kind === 'variant'))
                risks.push({ kind: 'variant', params: { sku: row.sku, other: variant.sku } });
            for (const [location, rows] of nearby) {
                const match = rows.find(other => similarCode(row.sku, other.sku));
                if (match && !risks.some(r => r.kind === 'nearby'))
                    risks.push({ kind: 'nearby', params: { sku: row.sku, other: match.sku, location } });
            }
            const movement = moves.get(row.sku);
            const positive = movement?.positive.has(loc.locationCode), other = movement ? [...(positive ? movement.negative : movement.positive)].filter(code => code !== loc.locationCode) : [];
            if (other.length && !risks.some(r => r.kind === 'move'))
                risks.push({ kind: 'move', params: { sku: row.sku, locations: other.slice(0, 5).join(', '), count: other.length } });
        }
        return { location: loc.locationCode, category: loc.changeType, skus, risks, changes: loc.changes };
    });
    return { comparison, config, targets, ...snakeRoute(targets.map(t => t.location), config) };
}
