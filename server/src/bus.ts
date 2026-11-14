import { EventEmitter } from "node:events";

/** Barramento interno: execuções publicam eventos e as conexões SSE assinam. */
export const bus = new EventEmitter();
bus.setMaxListeners(500);
