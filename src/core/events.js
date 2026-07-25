/**
 * Simple pub/sub event emitter — replaces window._ globals.
 * Usage: import { on, emit } from './events.js';
 *         on('bearing:update', ({ heading, lat, lon }) => { ... });
 *         emit('bearing:update', { heading: 180, lat: 10, lon: 106 });
 */
const listeners = {};

export function on(event, fn) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(fn);
  return () => off(event, fn); // returns unsubscribe function
}

export function off(event, fn) {
  if (!listeners[event]) return;
  listeners[event] = listeners[event].filter(f => f !== fn);
}

export function emit(event, data) {
  if (!listeners[event]) return;
  for (const fn of listeners[event]) {
    try {
      fn(data);
    } catch (e) {
      console.error('[Events]', event, e);
    }
  }
}

export function clear() {
  for (const k of Object.keys(listeners)) delete listeners[k];
}
