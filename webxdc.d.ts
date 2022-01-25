//@ts-check

type SendingStateUpdate<T> = {
  /** the payload, deserialized json:
   * any javascript primitive, array or object. */
  payload: T;
  /** optional, short, informational message that will be added to the chat,
   * eg. "Alice voted" or "Bob scored 123 in MyGame";
   * usually only one line of text is shown,
   * use this option sparingly to not spam the chat. */
  info?: string;
  /** optional, short text, shown beside app icon;
   * it is recommended to use some aggregated value,
   * eg. "8 votes", "Highscore: 123" */
  summary?: string;
};

type RecievedStateUpdate<T> = {
  /** the payload, deserialized json */
  payload: T;
};

interface WEBxDC<T> {
  /** Returns the peer's own address.
   *  This is esp. useful if you want to differ between different peers - just send the address along with the payload,
   *  and, if needed, compare the payload addresses against selfAddr() later on. */
  selfAddr(): string;
  /** Returns the peer's own name. This is name chosen by the user in their settings, if there is nothing set, that defaults to the peer's address. */
  selfName(): string;
  /**
   * set a listener for new state updates
   * note that own state updates, that you send with {@link sendStateUpdate}, also trigger this method
   * */
  setUpdateListener(cb: (stateUpdate: RecievedStateUpdate<T>) => void): void;
  /**
   * In case your Webxdc was just started,
   * you may want to reconstruct the state from the last run - and also incorporate updates that may have arrived while the app was not running.
   */
  getAllUpdates(): RecievedStateUpdate<T>[];
  /**
   * Webxdc apps are usually shared in a chat and run independently on each peer. To get a shared state, the peers use sendUpdate() to send updates to each other.
   * @param description short, human-readable description what this update is about. this is shown eg. as a fallback text in an email program.
   */
  sendUpdate(update: SendingStateUpdate<T>, description: string): void;
}

////////// ANCHOR: global
declare global {
  interface Window {
    webxdc: WEBxDC<any>;
  }
}
////////// ANCHOR_END: global

export { SendingStateUpdate, RecievedStateUpdate, WEBxDC };

/* Types for the Simulator */
declare global {
  interface Window {
    addXdcPeer: () => void;
    clearXdcStorage: () => void;
    alterXdcApp: () => void;
  }
}
