export function capability(action) {
    return 'name' in action ? `${action.type}.${action.name}` : action.type;
}
const object = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const text = (x) => typeof x === 'string' && x.trim().length > 0 && x.length <= 4096;
const keys = (x, allowed) => Object.keys(x).every(k => allowed.includes(k)) && allowed.every(k => Object.hasOwn(x, k));
export function parseCommand(input) {
    if (!object(input) || !keys(input, ['protocolVersion', 'id', 'bodyId', 'generation', 'action']) || input.protocolVersion !== '0.2' || !text(input.id) || !text(input.bodyId) || !text(input.generation) || !object(input.action))
        throw new Error('INVALID_COMMAND');
    const a = input.action;
    const intensity = typeof a.intensity === 'number' && Number.isFinite(a.intensity) && a.intensity >= 0 && a.intensity <= 1;
    const valid = (a.type === 'gesture' && keys(a, ['type', 'name', 'intensity']) && ['wave', 'head_tilt'].includes(String(a.name)) && intensity) ||
        (a.type === 'gaze' && keys(a, ['type', 'name', 'target']) && a.name === 'look_at' && text(a.target)) ||
        (a.type === 'movement' && keys(a, ['type', 'name', 'target', 'intensity']) && a.name === 'approach' && text(a.target) && intensity) ||
        (a.type === 'speech' && keys(a, ['type', 'text', 'locale']) && text(a.text) && text(a.locale)) ||
        (['stop', 'emergency_stop'].includes(String(a.type)) && keys(a, ['type']));
    if (!valid)
        throw new Error('INVALID_ACTION');
    return structuredClone(input);
}
/** Caller priority cannot elevate a motion above either stop kind. */
export function safetyOrder(commands) {
    const rank = (c) => c.action.type === 'emergency_stop' ? 2 : c.action.type === 'stop' ? 1 : 0;
    return [...commands].sort((a, b) => rank(b) - rank(a));
}
