import type { BridgeMessage } from '../shared/messages/bridge';
import { BRIDGE_INIT_TYPE } from '../shared/constants';

export type BridgeHandler = (msg: BridgeMessage) => void;

export class PipBridge {
  private port: MessagePort | null = null;
  private token: string;
  private handler: BridgeHandler | null = null;

  constructor(token?: string) {
    this.token = token ?? crypto.randomUUID();
  }

  get sessionToken(): string {
    return this.token;
  }

  onMessage(handler: BridgeHandler): void {
    this.handler = handler;
  }

  /**
   * Content side: establish MessageChannel with PiP window.
   */
  connectToPip(pipWindow: Window): void {
    const { port1, port2 } = new MessageChannel();
    this.port = port1;
    port1.onmessage = (ev) => {
      const data = ev.data as BridgeMessage & { token?: string };
      if (!data || typeof data !== 'object') return;
      this.handler?.(data);
    };
    pipWindow.postMessage(
      {
        type: BRIDGE_INIT_TYPE,
        sessionToken: this.token,
        requestId: crypto.randomUUID(),
      },
      pipWindow.origin === 'null' ? '*' : pipWindow.origin,
      [port2],
    );
  }

  /**
   * PiP side: accept init from opener.
   */
  static acceptFromOpener(
    expectedToken: string | null,
    onReady: (bridge: PipBridge) => void,
  ): void {
    const listener = (event: MessageEvent) => {
      if (event.source !== window.opener && event.source !== null) {
        // Document PiP: opener is the page window
      }
      const data = event.data as {
        type?: string;
        sessionToken?: string;
      };
      if (!data || data.type !== BRIDGE_INIT_TYPE) return;
      if (expectedToken && data.sessionToken !== expectedToken) return;
      if (!event.ports?.[0]) return;

      const bridge = new PipBridge(data.sessionToken);
      bridge.port = event.ports[0];
      bridge.port.onmessage = (ev) => {
        bridge.handler?.(ev.data as BridgeMessage);
      };
      bridge.port.start?.();
      window.removeEventListener('message', listener);
      onReady(bridge);
    };
    window.addEventListener('message', listener);
  }

  send(msg: BridgeMessage): void {
    this.port?.postMessage(msg);
  }

  close(): void {
    this.port?.close();
    this.port = null;
  }
}
