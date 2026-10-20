import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from '../../stores/auth';
import { CoolapkTauriAPI } from '../../api/coolapk';

describe('auth store', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('starts with logged-out state', () => {
    const store = useAuthStore();
    expect(store.isLoggedIn).toBe(false);
    expect(store.user).toBeNull();
    expect(store.rawCookie).toBe('');
    expect(store.isLoginModalOpen).toBe(false);
  });

  it('openLoginModal sets modal flag', () => {
    const store = useAuthStore();
    store.openLoginModal();
    expect(store.isLoginModalOpen).toBe(true);
  });

  it('closeLoginModal clears modal flag', () => {
    const store = useAuthStore();
    store.openLoginModal();
    store.closeLoginModal();
    expect(store.isLoginModalOpen).toBe(false);
  });

  it('logout clears user state and localStorage', async () => {
    const clearCookie = vi.spyOn(CoolapkTauriAPI, 'clearCookie').mockResolvedValue(undefined as any);
    const removeAccount = vi.spyOn(CoolapkTauriAPI, 'removeAccount').mockResolvedValue(undefined as any);
    vi.spyOn(CoolapkTauriAPI, 'listAccounts').mockResolvedValue({
      code: 200,
      data: [{ uid: '1', username: 'test', userAvatar: '' }]
    } as any);
    const store = useAuthStore();
    store.user = { uid: '1', username: 'test', userAvatar: '' };
    store.isLoggedIn = true;
    store.rawCookie = 'SESSID=abc';
    localStorage.setItem('coolapk_cookie', 'SESSID=abc');
    localStorage.setItem('coolapk_user', JSON.stringify({ uid: '1' }));

    await store.logout();

    expect(store.isLoggedIn).toBe(false);
    expect(store.user).toBeNull();
    expect(store.rawCookie).toBe('');
    expect(localStorage.getItem('coolapk_cookie')).toBeNull();
    expect(localStorage.getItem('coolapk_user')).toBeNull();
    expect(clearCookie).toHaveBeenCalledOnce();
    expect(removeAccount).not.toHaveBeenCalled();
    expect(store.accounts).toHaveLength(1);
  });

  it('keeps a cookie when the server cannot confirm login', async () => {
    vi.spyOn(CoolapkTauriAPI, 'saveCookie').mockResolvedValue(undefined as any);
    vi.spyOn(CoolapkTauriAPI, 'checkLoginStatus').mockRejectedValue(new Error('HTTP 403'));
    const clearCookie = vi.spyOn(CoolapkTauriAPI, 'clearCookie').mockResolvedValue(undefined as any);
    const saveAccount = vi.spyOn(CoolapkTauriAPI, 'saveAccount').mockResolvedValue(undefined as any);

    const store = useAuthStore();
    await expect(store.loginWithCookie('uid=12345; username=test; token=only-token')).rejects.toThrow('接口未能确认登录状态');

    expect(store.isLoggedIn).toBe(false);
    expect(store.user).toBeNull();
    expect(clearCookie).not.toHaveBeenCalled();
    expect(saveAccount).not.toHaveBeenCalled();
  });

  it('clears a cookie only when the API explicitly reports a logged-out uid', async () => {
    vi.spyOn(CoolapkTauriAPI, 'saveCookie').mockResolvedValue(undefined as any);
    vi.spyOn(CoolapkTauriAPI, 'checkLoginStatus').mockResolvedValue({
      code: 200,
      data: { uid: '10000' }
    } as any);
    const clearCookie = vi.spyOn(CoolapkTauriAPI, 'clearCookie').mockResolvedValue(undefined as any);

    const store = useAuthStore();
    await expect(store.loginWithCookie('SESSID=session; uid=12345')).rejects.toThrow('返回未登录状态');

    expect(clearCookie).toHaveBeenCalledOnce();
    expect(store.isLoggedIn).toBe(false);
  });

  it('keeps a cookie when the API response does not identify an account', async () => {
    vi.spyOn(CoolapkTauriAPI, 'saveCookie').mockResolvedValue(undefined as any);
    vi.spyOn(CoolapkTauriAPI, 'checkLoginStatus').mockResolvedValue({
      code: 200,
      data: {}
    } as any);
    const clearCookie = vi.spyOn(CoolapkTauriAPI, 'clearCookie').mockResolvedValue(undefined as any);

    const store = useAuthStore();
    await expect(store.loginWithCookie('SESSID=session; uid=12345')).rejects.toThrow('没有返回账号 UID');

    expect(clearCookie).not.toHaveBeenCalled();
    expect(store.isLoggedIn).toBe(false);
  });

  it('unwraps the native response and persists a validated cookie account', async () => {
    vi.spyOn(CoolapkTauriAPI, 'saveCookie').mockResolvedValue(undefined as any);
    vi.spyOn(CoolapkTauriAPI, 'checkLoginStatus').mockResolvedValue({
      code: 200,
      data: { uid: '12345', username: 'test-user', userAvatar: 'avatar.png', level: 5 }
    } as any);
    const saveAccount = vi.spyOn(CoolapkTauriAPI, 'saveAccount').mockResolvedValue({ code: 200 } as any);
    vi.spyOn(CoolapkTauriAPI, 'listAccounts').mockResolvedValue({ code: 200, data: [] } as any);

    const store = useAuthStore();
    const profile = await store.loginWithCookie('SESSID=valid-session; uid=12345');

    expect(profile.uid).toBe('12345');
    expect(profile.username).toBe('test-user');
    expect(store.isLoggedIn).toBe(true);
    expect(store.rawCookie).toBe('');
    expect(saveAccount).toHaveBeenCalledWith('12345', 'test-user', 'avatar.png', 'SESSID=valid-session; uid=12345');
  });

  it('clears a stale logged-in UI when status validation fails', async () => {
    vi.spyOn(CoolapkTauriAPI, 'checkLoginInfo').mockRejectedValue(new Error('invalid session'));
    vi.spyOn(CoolapkTauriAPI, 'checkLoginStatus').mockRejectedValue(new Error('invalid session'));
    const store = useAuthStore();
    store.user = { uid: '12345', username: 'stale', userAvatar: '' };
    store.isLoggedIn = true;
    localStorage.setItem('coolapk_user', JSON.stringify(store.user));

    await expect(store.checkStatus()).resolves.toBe(false);

    expect(store.isLoggedIn).toBe(false);
    expect(store.user).toBeNull();
    expect(localStorage.getItem('coolapk_user')).toBeNull();
  });

  it('does not restore cached profile as a valid login on startup', async () => {
    vi.spyOn(CoolapkTauriAPI, 'listAccounts').mockResolvedValue({ code: 200, data: [] } as any);
    vi.spyOn(CoolapkTauriAPI, 'checkLoginStatus').mockRejectedValue(new Error('no session'));
    localStorage.setItem('coolapk_user', JSON.stringify({ uid: '12345', username: 'cached' }));

    const store = useAuthStore();
    await store.initAuth();

    expect(store.isLoggedIn).toBe(false);
    expect(store.user).toBeNull();
    expect(localStorage.getItem('coolapk_user')).toBeNull();
  });
});
