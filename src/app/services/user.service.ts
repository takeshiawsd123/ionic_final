import { Injectable } from '@angular/core';

const USER_KEY = 'mp_user_id';
const TOKEN_KEY = 'mp_auth_token';

@Injectable({ providedIn: 'root' })
export class UserService {
  getUserId(): string {
    let id = localStorage.getItem(USER_KEY);
    if (!id) {
      id = this.createId();
      localStorage.setItem(USER_KEY, id);
    }
    return id;
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  setToken(token: string | null): void {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }

  private createId(): string {
    const cryptoApi = globalThis.crypto as Crypto | undefined;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
    return `user-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
