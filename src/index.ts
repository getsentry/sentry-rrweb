import { record, EventType } from 'rrweb';
import * as Sentry from '@sentry/browser';
import { Dsn, Event } from '@sentry/types';

type RRWebEvent = {
  type: EventType;
  data: {};
  timestamp: number;
  delay?: number;
};

type RRWebOptions = Parameters<typeof record>[0];

// TODO: replace with library function
function makeid() {
  var result = '';
  var characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var charactersLength = characters.length;
  for (var i = 0; i < 15; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

// plan:
// create session on first init if doesn't exist
// TODO: look at sentry session id instead
// update backend on new sentry tx's / errs
// update backend every 30s/1m otherwise
// keep last_updated timestamp on session

// use sessionId to handle replay collecting
// need to continuously update replay as we don't know when session will end
// if inactive for 15 minutes, end session
// if closes tab, end session
// know which tab you're on via sessionStorage

// detect page close with:

// document.addEventListener('visibilitychange', function logData() {
//   if (document.visibilityState === 'hidden') {
//     navigator.sendBeacon('/log', analyticsData);
//   }
// });
//

// if session doesn't exist but items in localstorage, send those ls items, create new session

class BasicSession {
  id: string;
  lastActivity: Date;
  constructor() {
    this.id = makeid();
    this.lastActivity = new Date();
  }
}

const getSession = () => {
  const sessionFromStorage = window.localStorage.__sentrySession;
  if (sessionFromStorage) {
    return JSON.parse(window.localStorage.__sentrySession);
  }
  const newSession = new BasicSession();
  window.localStorage.__sentrySession = JSON.stringify(newSession);
  return newSession;
};

class ReplayObserver {
  RRWebClient: SentryRRWeb;
  sentryClient: any;
  sentryEvents: String[];
  session: BasicSession;
  public constructor(
    RRWebClient: SentryRRWeb,
    sentryClient: any,
    session: BasicSession
  ) {
    this.RRWebClient = RRWebClient;
    this.sentryClient = sentryClient;
    this.sentryEvents = [];
    this.session = session;
  }
  public attachmentUrlFromDsn(dsn: Dsn) {
    const { host, path, projectId, port, protocol, user } = dsn;
    return `${protocol}://${host}${port !== '' ? `:${port}` : ''}${
      path !== '' ? `/${path}` : ''
    }/t-api/${projectId}/replay-store/${this.session.id}/`;
  }

  public collectData = async () => {
    const client = Sentry.getCurrentHub().getClient();
    const endpoint = this.attachmentUrlFromDsn(client.getDsn());

    try {
      if (!this.RRWebClient.events.length) return;

      fetch(endpoint, {
        method: 'POST',
        // mode: 'no-cors',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          events: this.RRWebClient.events,
          sentryEvents: this.sentryEvents,
          sessionId: this.session.id,
        }),
      })
        .then(() => {
          // empty rrweb events collection
          this.RRWebClient.events = [];
          console.log('successfully posted replay data');
        })
        .catch((ex) => {
          // we have to catch this otherwise it throws an infinite loop in Sentry
          console.error(ex);
        });
    } catch (ex) {
      console.error(ex);
    }
  };
}

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
    console.log('initsetup');
    Sentry.addGlobalEventProcessor((event: Event) => {
      console.log('new sentry event');
      // @ts-ignore
      let self;
      // TODO
      self = Sentry.getCurrentHub().getIntegration(SentryRRWeb);
      const client = Sentry.getCurrentHub().getClient();

      // @ts-ignore
      if (!window.ro) {
        const session = getSession();
        const ro = new ReplayObserver(self, client, session);
        // @ts-ignore
        window.ro = ro;
      }

      if (!self) return;
      console.log(event);
      // @ts-ignore
      window.ro.sentryEvents.push(event.event_id);
      // @ts-ignore
      window.ro.collectData();

      return event;
    });
  }
}
