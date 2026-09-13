import { SimulatedController } from './generated/v02/controller.js';
import { PhysicalRuntime } from './generated/v02/runtime.js';

// Fault injection belongs to the lab, not the v0.2 implementation.
export class LabController {
  constructor() {
    this.local = new SimulatedController();
    this.connected = true; this.obstacle = false; this.timeoutNext = false;
    this.waveEnabled = true; this.active = null; this.phase = 'idle'; this.listeners = new Set();
    this.local.subscribe(r => {
      if (this.active?.id === r.commandId) { this.active = null; this.phase = r.status; }
      this.emit(r);
    });
  }
  emit(r) { for (const fn of this.listeners) fn(r); }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  state() { return { ...this.local.state(), collisionAvoidance: !this.obstacle, watchdogArmed: this.connected }; }
  capabilities() { return this.local.capabilities().filter(c => this.waveEnabled || c !== 'gesture.wave'); }
  async request(c) {
    if (!this.connected) throw new Error('DISCONNECTED');
    if (this.timeoutNext) { this.timeoutNext = false; return new Promise(() => {}); }
    if (this.obstacle) throw new Error('OBSTACLE');
    const r = await this.local.request(c);
    if (r.status === 'accepted') { this.active = structuredClone(c); this.phase = 'accepted'; }
    return r;
  }
  async halt(emergency) {
    if (!this.connected) throw new Error('DISCONNECTED');
    return this.local.halt(emergency);
  }
  async recover(generation) {
    if (!this.connected || this.obstacle) throw new Error('LAB_SAFETY_NOT_READY');
    await this.local.recover(generation); this.phase = 'idle';
  }
  start() {
    if (!this.active || this.phase !== 'accepted') return;
    this.phase = 'running';
    this.emit({ commandId:this.active.id, bodyId:this.active.bodyId, status:'running' });
  }
  finish(failed = false) {
    if (!this.active || this.phase !== 'running') return;
    this.local.finish(this.active.id, this.active.generation, failed ? 'failed' : 'completed');
  }
  async setObstacle(value) { this.obstacle = value; if (value) await this.local.safetyTrip(); }
  async disconnect() {
    this.connected = false;
    // Independent local watchdog simulation. Runtime cannot receive a stop ACK over this link.
    await this.local.safetyTrip();
  }
}

export class BodyLab {
  constructor(timeoutMs = 800) {
    this.controller = new LabController(); this.history = []; this.sequence = 0; this.saved = null;
    this.runtime = new PhysicalRuntime({ mayControl:id => id === 'lab-body', mayRecover:id => id === 'lab-body' }, timeoutMs);
    this.runtime.register('lab-body', this.controller);
    this.runtime.subscribe(r => this.record('result', r));
    this.onChange = () => {};
  }
  record(kind, value) {
    this.history.unshift({time:new Date().toISOString(),kind,value:structuredClone(value)});
    this.history.length = Math.min(this.history.length, 200); this.onChange();
  }
  command(action = {type:'gesture',name:'wave',intensity:.7}) {
    return {protocolVersion:'0.2',id:`lab-${++this.sequence}`,bodyId:'lab-body',generation:this.controller.state().generation,action};
  }
  async send(c = this.command()) {
    this.record('command', c);
    try { return await this.runtime.route(c); }
    catch(error) { this.record('error',{message:error.message}); }
    finally { this.onChange(); }
  }
  save() { this.saved = this.command(); this.record('saved',this.saved); }
  async recover() {
    try { await this.runtime.recover('lab-body'); this.record('operator',{action:'recover',outcome:'ready'}); }
    catch(error) { this.record('operator',{action:'recover',outcome:error.message}); }
    this.onChange();
  }
}
