export function createServer(): never {
  throw new Error('TCP server is only available in the iOS build.');
}

export default class Zeroconf {
  publishService(): Promise<never> {
    return Promise.reject(new Error('Bonjour is only available in the iOS build.'));
  }
  unpublishService(): Promise<void> {
    return Promise.resolve();
  }
}
