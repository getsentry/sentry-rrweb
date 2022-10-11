import { record, EventType } from 'rrweb';
import * as Sentry from '@sentry/browser';
import { Event } from '@sentry/types';

type RRWebEvent = {
  type: EventType;
  data: {};
  timestamp: number;
  delay?: number;
};

type RRWebOptions = Parameters<typeof record>[0] & { errorsOnly?: boolean; };

export default class SentryRRWeb {
  public readonly name: string = SentryRRWeb.id;
  public static id: string = 'SentryRRWeb';

  public events: Array<RRWebEvent> = [];

  private readonly recordOptions: RRWebOptions;

  public constructor({
    checkoutEveryNms = 5 * 60 * 1000,
    maskAllInputs = true,
    ...recordOptions
  }: RRWebOptions = {}) {
    // default checkout time of 5 minutes
    this.recordOptions = {
      checkoutEveryNms,
      maskAllInputs,
      ...recordOptions,
    };
    this.events = [];

    record({
      ...this.recordOptions,
      emit: (event: RRWebEvent, isCheckout?: boolean) => {
        if (isCheckout) {
          this.events = [event];
        } else {
          this.events.push(event);
        }
      },
    });
  }

  public setupOnce() {
    Sentry.addGlobalEventProcessor((event: Event) => this.processEvent(event));
  }

  // In version 6.10 of the JS SDK, `dsn.publicKey` was introduced to replace
  // `dsn.user`, and in version 7.0.0, `dsn.user` was removed. Further, 7.0.0
  // removed the `Dsn` type in favor of the `DsnComponents` type. Since for now
  // our peer dependency is marked as >=4.0.0, we type `dsn` as `any` and look
  // for both properties, to cover our bases as much as possible.
  public attachmentUrlFromDsn(dsn: any, eventId: string) {
    const { host, path, projectId, port, protocol } = dsn;
    const publicKey = dsn.publicKey || dsn.user;
    return `${protocol}://${host}${port !== '' ? `:${port}` : ''}${
      path !== '' ? `/${path}` : ''
    }/api/${projectId}/events/${eventId}/attachments/?sentry_key=${publicKey}&sentry_version=7&sentry_client=rrweb`;
  }

  protected processEvent(event: Event) {
    const self = Sentry.getCurrentHub().getIntegration(SentryRRWeb);
    if (!self) return;
    try {
      // short circuit if theres no events to replay
      if (!this.events.length) return;
      if (this.recordOptions['errorsOnly'] && event.type === 'transaction') {
        return event;
      }
      const client = Sentry.getCurrentHub().getClient();
      const endpoint = self.attachmentUrlFromDsn(
        client.getDsn(),
        event.event_id
      );
      const formData = new FormData();
      formData.append(
        'rrweb',
        new Blob([JSON.stringify({ events: self.events })], {
          type: 'application/json',
        }),
        'rrweb.json'
      );
      fetch(endpoint, {
        method: 'POST',
        body: formData,
      }).catch((ex) => {
        // we have to catch this otherwise it throws an infinite loop in Sentry
        console.error(ex);
      });
      return event;
    } catch (ex) {
      console.error(ex);
    }
  }
}
