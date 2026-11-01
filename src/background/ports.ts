import type { CalendarSummary, Store } from "../shared/model";

export interface TokenRequest {
  accountId?: string;
  interactive: boolean;
  chooseAccount?: boolean;
}
export interface IdentityProvider {
  getToken(request: TokenRequest): Promise<string>;
  invalidateToken(token: string): Promise<void>;
}
export interface GoogleGateway {
  getProfile(token: string): Promise<{ id: string; email: string }>;
  listCalendars(token: string): Promise<CalendarSummary[]>;
}
export interface Repository {
  read(): Promise<Store>;
  write(store: Store): Promise<void>;
}
export interface Badge {
  update(reconnectCount: number): Promise<void>;
}
