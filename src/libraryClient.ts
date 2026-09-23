import * as cheerio from 'cheerio';
import fetchCookie from 'fetch-cookie';
import { CookieJar } from 'tough-cookie';

const BASE_URL = 'https://www.library.otsu.shiga.jp/opw/OPW/';
const LOGIN_PAGE_URL =
  `${BASE_URL}OPWUSERCONF.CSP?DB=LIB&MODE=1&PID2=OPWSRCH1&PREPID=OPWSRCH1&NEXTPID=OPWSRCH1&HEADFLG=1`;
const LOGIN_POST_URL = `${BASE_URL}OPWUSERLOGIN.CSP`;
const USER_INFO_URL = `${BASE_URL}OPWUSERINFO.CSP?DB=LIB&MODE=1`;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) otsu-library-checker/1.0';

export class LoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginError';
  }
}

export class LibraryClient {
  private readonly fetch: ReturnType<typeof fetchCookie<string, RequestInit, Response>>;
  /** デバッグ用: 取得したページを (名前, HTML) で記録する */
  readonly pages: Array<{ name: string; html: string }> = [];

  constructor() {
    this.fetch = fetchCookie(globalThis.fetch, new CookieJar());
  }

  async login(cardNo: string, password: string): Promise<void> {
    const loginPageHtml = await this.get('login-page', LOGIN_PAGE_URL);
    const form = extractLoginForm(loginPageHtml);

    const body = new URLSearchParams();
    for (const [name, value] of Object.entries(form.hiddenFields)) {
      body.set(name, value);
    }
    body.set('usercardno', cardNo);
    body.set('userpasswd', password);
    body.set('Login', form.submitValue);

    const res = await this.fetch(new URL(form.action, LOGIN_POST_URL).toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        Referer: LOGIN_PAGE_URL,
      },
      body: body.toString(),
    });
    const bounceHtml = await res.text();
    this.pages.push({ name: 'login-post', html: bounceHtml });
    if (!res.ok) {
      throw new LoginError(`ログインリクエストが失敗しました: HTTP ${res.status}`);
    }

    const message = extractLoginMessage(bounceHtml);
    if (message) {
      throw new LoginError(`ログインに失敗しました: ${message}`);
    }

    // 自動submitされるバウンスページの遷移先を辿ってセッションを確立する
    const next = extractBounceTarget(bounceHtml);
    if (next) {
      await this.get('login-bounce', new URL(next.action, LOGIN_POST_URL).toString(), next.params);
    }
  }

  async fetchUserInfo(): Promise<string> {
    const html = await this.get('user-info', USER_INFO_URL);
    if (looksLikeLoginPage(html)) {
      throw new LoginError('貸出・予約照会ページがログイン画面にリダイレクトされました（セッション未確立）');
    }
    return html;
  }

  private async get(name: string, url: string, params?: URLSearchParams): Promise<string> {
    const res = await this.fetch(params ? `${url}${url.includes('?') ? '&' : '?'}${params}` : url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT },
    });
    const html = await res.text();
    this.pages.push({ name, html });
    if (!res.ok) {
      throw new Error(`${name} の取得に失敗しました: HTTP ${res.status} (${url})`);
    }
    return html;
  }
}

interface LoginForm {
  action: string;
  hiddenFields: Record<string, string>;
  submitValue: string;
}

function extractLoginForm(html: string): LoginForm {
  const $ = cheerio.load(html);
  const $form = $('form').filter((_, f) => $(f).find('input[name="usercardno"]').length > 0).first();
  if ($form.length === 0) {
    throw new Error('ログインフォームが見つかりませんでした（サイト構造が変わった可能性があります）');
  }

  const hiddenFields: Record<string, string> = {};
  $form.find('input[type="hidden"]').each((_, el) => {
    const name = $(el).attr('name');
    if (name) hiddenFields[name] = $(el).attr('value') ?? '';
  });

  return {
    action: $form.attr('action') ?? 'OPWUSERLOGIN.CSP',
    hiddenFields,
    submitValue: $form.find('input[name="Login"]').attr('value') ?? '送信',
  };
}

function extractLoginMessage(html: string): string | undefined {
  const $ = cheerio.load(html);
  const mes = $('input[name="MES"]').attr('value')?.trim();
  if (mes) return mes;

  const text = $('body').text();
  const m = text.match(/(利用券番号|パスワード)[^。\n]*(誤り|正しく|違い|不正)[^。\n]*。?/);
  return m?.[0]?.trim();
}

function extractBounceTarget(html: string): { action: string; params: URLSearchParams } | undefined {
  const $ = cheerio.load(html);
  const $form = $('form').first();
  if ($form.length === 0) return undefined;

  const params = new URLSearchParams();
  $form.find('input').each((_, el) => {
    const name = $(el).attr('name');
    const type = ($(el).attr('type') ?? 'text').toLowerCase();
    if (name && type !== 'submit' && type !== 'password') {
      params.set(name, $(el).attr('value') ?? '');
    }
  });
  return { action: $form.attr('action') ?? 'OPWUSERCONF.CSP', params };
}

function looksLikeLoginPage(html: string): boolean {
  return (
    /name=["']?usercardno/.test(html) ||
    /http-equiv=["']?refresh["']?[^>]*OPWUSERCONF/i.test(html)
  );
}
