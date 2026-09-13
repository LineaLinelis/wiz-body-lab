import { capability, parseCommand, safetyOrder } from './protocol.js';
export class PhysicalRuntime {
    authority;
    timeoutMs;
    bodies = new Map();
    faults = new Set();
    stopping = new Map();
    revisions = new Map();
    recovering = new Set();
    listeners = new Set();
    constructor(authority, timeoutMs = 1000) {
        this.authority = authority;
        this.timeoutMs = timeoutMs;
    }
    register(id, controller) {
        if (!id || this.bodies.has(id))
            throw new Error('INVALID_BODY');
        this.bodies.set(id, controller);
        controller.subscribe(r => { if (r.bodyId === id)
            this.emit(r); });
    }
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(r) { for (const fn of this.listeners) {
        try {
            fn(r);
        }
        catch { /* observer isolation */ }
    } return r; }
    async bounded(promise) {
        let timer;
        try {
            return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), this.timeoutMs); })]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    async route(input) {
        const c = parseCommand(input); // invalid wire data never reaches the body
        const result = (status, code) => this.emit({ commandId: c.id, bodyId: c.bodyId, status, ...(code ? { code } : {}) });
        if (!this.authority.mayControl(c.bodyId))
            return result('failed', 'UNAUTHORIZED');
        const body = this.bodies.get(c.bodyId);
        if (!body)
            return result('failed', 'BODY_NOT_CONNECTED');
        const halt = c.action.type === 'stop' || c.action.type === 'emergency_stop';
        if (halt) {
            this.stopping.set(c.bodyId, (this.stopping.get(c.bodyId) ?? 0) + 1);
            this.revisions.set(c.bodyId, (this.revisions.get(c.bodyId) ?? 0) + 1);
            this.faults.add(c.bodyId);
            try {
                const ack = await this.bounded(body.halt(c.action.type === 'emergency_stop'));
                if (!ack.confirmed || !['stopped', 'emergency_stopped'].includes(body.state().mode))
                    return result('failed', 'STOP_UNCONFIRMED');
                return result('stopped');
            }
            catch {
                return result('failed', 'STOP_UNCONFIRMED');
            }
            finally {
                const remaining = (this.stopping.get(c.bodyId) ?? 1) - 1;
                if (remaining)
                    this.stopping.set(c.bodyId, remaining);
                else
                    this.stopping.delete(c.bodyId);
            }
        }
        if (this.faults.has(c.bodyId) || this.recovering.has(c.bodyId))
            return result('failed', 'STOP_LATCHED');
        if (!body.capabilities().includes(capability(c.action)))
            return result('unsupported', 'UNSUPPORTED');
        const s = body.state();
        if (s.mode !== 'ready' || !s.collisionAvoidance || !s.limitsEnforced || !s.watchdogArmed)
            return result('failed', 'SAFETY_NOT_READY');
        if (s.generation !== c.generation)
            return result('failed', 'STALE_GENERATION');
        try {
            const ack = await this.bounded(body.request(c));
            if (ack.commandId !== c.id || ack.bodyId !== c.bodyId || !['accepted', 'failed', 'unsupported'].includes(ack.status))
                throw new Error('INVALID_ACK');
            if (body.state().generation !== c.generation || this.faults.has(c.bodyId))
                return result('cancelled', 'INTERRUPTED');
            return this.emit(ack);
        }
        catch {
            this.faults.add(c.bodyId);
            try {
                await this.bounded(body.halt(true));
            }
            catch { /* unknown outcome remains latched */ }
            return result('failed', 'CONTROLLER_UNCONFIRMED');
        }
    }
    async routeBatch(inputs) {
        const commands = safetyOrder(inputs.map(parseCommand));
        const results = [];
        for (const c of commands)
            results.push(await this.route(c));
        return results;
    }
    async recover(bodyId) {
        if (!this.authority.mayRecover(bodyId))
            throw new Error('RECOVERY_UNAUTHORIZED');
        if (this.stopping.has(bodyId))
            throw new Error('STOP_PENDING');
        const body = this.bodies.get(bodyId);
        if (!body)
            throw new Error('BODY_NOT_CONNECTED');
        // Unconfirmed controller operations cannot be cleared remotely. Require a
        // locally confirmed stopped state first (watchdog / operator intervention).
        if (!['stopped', 'emergency_stopped'].includes(body.state().mode))
            throw new Error('LOCAL_STOP_REQUIRED');
        if (this.recovering.has(bodyId))
            throw new Error('RECOVERY_PENDING');
        const revision = this.revisions.get(bodyId) ?? 0;
        this.recovering.add(bodyId);
        this.faults.add(bodyId);
        try {
            await this.bounded(body.recover(body.state().generation));
            if ((this.revisions.get(bodyId) ?? 0) !== revision || body.state().mode !== 'ready') {
                await this.bounded(body.halt(true));
                throw new Error('RECOVERY_INTERRUPTED');
            }
            this.faults.delete(bodyId);
        }
        catch (error) {
            try {
                await this.bounded(body.halt(true));
            }
            catch { /* retain fault latch */ }
            throw error;
        }
        finally {
            this.recovering.delete(bodyId);
        }
    }
}
