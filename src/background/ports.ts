import type { CalendarSummary, Store } from "../shared/model";
import type { EventBody } from "../calendar/write-model";
import type { GoogleEvent } from "../calendar/google-events";

export interface TokenRequest {
  accountId?: string;
  interactive: boolean;
  chooseAccount?: boolean;
  webClientId?: string;
}
export interface IdentityProvider {
  getToken(request: TokenRequest): Promise<string>;
  invalidateToken(token: string): Promise<void>;
}
export interface GoogleGateway {
  getProfile(token: string): Promise<{ id: string; email: string }>;
  listCalendars(token: string): Promise<CalendarSummary[]>;
}
export interface EventGateway {
  getChanges(
    token: string,
    calendarId: string,
    syncToken?: string,
  ): Promise<{ syncToken: string; changed: boolean }>;
  getInstances(
    token: string,
    calendarId: string,
    start: string,
    end: string,
  ): Promise<{ events: GoogleEvent[]; timeZone: string }>;
}
export interface Repository {
  read(): Promise<Store>;
  write(store: Store): Promise<void>;
}
export interface Badge {
  update(reconnectCount: number): Promise<void>;
}

export interface EventWriteGateway {
  getEvent(
    token: string,
    calendarId: string,
    eventId: string,
  ): Promise<GoogleEvent>;
  insertEvent(
    token: string,
    calendarId: string,
    body: EventBody,
    sendUpdates: "all" | "none",
  ): Promise<GoogleEvent>;
  patchEvent(
    token: string,
    calendarId: string,
    eventId: string,
    body: EventBody,
    etag: string,
    sendUpdates: "all" | "none",
  ): Promise<GoogleEvent>;
  deleteEvent(
    token: string,
    calendarId: string,
    eventId: string,
    etag: string,
    sendUpdates: "all" | "none",
  ): Promise<void>;
  listCalendars(token: string): Promise<CalendarSummary[]>;
}
