import { capability } from './protocol.js';
/** Simulator, not a hardware safety implementation. Local watchdog is independently driven. */
export class SimulatedController {
    current = { generation: crypto.randomUUID(), mode: 'stopped', collisionAvoidance: true, limitsEnforced: true, watchdogArmed: true };
    active;
    seen = new Set();
    listeners = new Set();
    state() { return { ...this.current }; }
    capabilities() { return ['gesture.wave', 'gesture.head_tilt', 'gaze.look_at', 'movement.approach', 'speech']; }
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(r) { for (const fn of this.listeners) {
        try {
            fn(r);
        }
        catch { /* telemetry must not block safety */ }
    } }
    async request(c) {
        const fail = (code) => ({ commandId: c.id, bodyId: c.bodyId, status: 'failed', code });
        if (this.current.mode !== 'ready')
            return fail('STOP_LATCHED');
        if (c.generation !== this.current.generation)
            return fail('STALE_GENERATION');
        if (!this.current.collisionAvoidance || !this.current.limitsEnforced || !this.current.watchdogArmed)
            return fail('SAFETY_NOT_READY');
        if (!this.capabilities().includes(capability(c.action)))
            return { ...fail('UNSUPPORTED'), status: 'unsupported' };
        if (this.seen.has(c.id))
            return fail('DUPLICATE');
        if (this.active)
            return fail('BUSY');
        this.seen.add(c.id);
        this.active = structuredClone(c);
        return { commandId: c.id, bodyId: c.bodyId, status: 'accepted' };
    }
    /** Test hardware feedback: terminal result only after local observation. */
    finish(commandId, generation, status = 'completed') {
        const c = this.active;
        if (!c || c.id !== commandId || c.generation !== generation)
            return;
        this.active = undefined;
        this.emit({ commandId: c.id, bodyId: c.bodyId, status });
    }
    async halt(emergency) {
        this.current.mode = emergency || this.current.mode === 'emergency_stopped' ? 'emergency_stopped' : 'stopped';
        this.current.generation = crypto.randomUUID();
        const c = this.active;
        this.active = undefined;
        if (c)
            this.emit({ commandId: c.id, bodyId: c.bodyId, status: 'cancelled' });
        return { confirmed: true };
    }
    async recover(expectedGeneration) {
        if (expectedGeneration !== this.current.generation || !['stopped', 'emergency_stopped'].includes(this.current.mode))
            throw new Error('STALE_RECOVERY');
        if (!this.current.collisionAvoidance || !this.current.limitsEnforced || !this.current.watchdogArmed)
            throw new Error('SAFETY_NOT_READY');
        this.current.generation = crypto.randomUUID();
        this.seen.clear();
        this.current.mode = 'ready';
    }
    /** Simulates local link-loss watchdog/obstacle circuit, not an AI message. */
    async safetyTrip() { await this.halt(true); }
}
